// One behaviour, two backends: the JSON file store and the Postgres store must
// answer every call the same way.
const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { createJsonStore } = require("../src/storage");
const { createPostgresStore, poolFromEnvironment, sslOptions } = require("../src/postgres-store");
const { startPostgres } = require("./pglite-server");

const backends = {
  async json() {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "store-contract-"));
    return { store: createJsonStore(path.join(directory, "db.json")), stop: () => fsp.rm(directory, { recursive: true, force: true }) };
  },
  async postgres() {
    const server = await startPostgres();
    const store = createPostgresStore({ createPool: () => poolFromEnvironment({ DATABASE_URL: server.url }) });
    return { store, stop: async () => { await store.close(); await server.stop(); } };
  }
};

const work = (id, extra = {}) => ({ id, ownerId: "u1", title: id.toUpperCase(), chapters: [], ...extra });

for (const [name, open] of Object.entries(backends)) {
  test(`${name}: an empty store reads as an empty database`, async () => {
    const { store, stop } = await open();
    try {
      const database = await store.read();
      assert.equal(database.schemaVersion, 0);
      assert.deepEqual(database.works, []);
      assert.deepEqual(await store.listWorks("u1"), []);
      assert.equal(await store.getWork("x"), null);
      assert.deepEqual(await store.readRecords("tasks"), []);
      assert.equal(await store.readDocument("settings", "dailyTokenLimit"), null);
    } finally { await stop(); }
  });

  test(`${name}: whole-database write, read and transact keep values, order and revisions`, async () => {
    const { store, stop } = await open();
    try {
      const saved = await store.write({
        schemaVersion: 6,
        works: [work("b", { language: "en", nested: { z: 1, a: [2, { y: null }] } }), work("a", { ownerId: "u2" }), { id: "legacy", title: "No owner", chapters: [] }],
        tasks: [{ id: "t1", status: "queued" }],
        userPreferences: { u1: { theme: "candle" } },
        settings: { dailyTokenLimit: 5 },
        somethingElse: { kept: true }
      });
      assert.equal(saved.storeRevision, 1);
      const database = await store.read();
      assert.deepEqual(database.works.map((item) => item.id), ["b", "a", "legacy"]);
      // Key order survives the round trip: stories are compared as JSON text.
      assert.equal(JSON.stringify(database.works[0].nested), JSON.stringify({ z: 1, a: [2, { y: null }] }));
      assert.equal(database.works[0].rowVersion, 1);
      assert.equal(database.works[0].structureRevision, 1);
      assert.deepEqual(database.tasks, [{ id: "t1", status: "queued" }]);
      assert.deepEqual(database.userPreferences, { u1: { theme: "candle" } });
      assert.deepEqual(database.settings, { dailyTokenLimit: 5 });
      assert.deepEqual(database.somethingElse, { kept: true });
      assert.equal(database.storeRevision, 1);

      await assert.rejects(store.write({ ...database, storeRevision: 0 }), { code: "STORE_REVISION_CONFLICT" });

      const result = await store.transact((db) => {
        db.works.find((item) => item.id === "a").title = "A2";
        db.works = db.works.filter((item) => item.id !== "legacy");
        db.tasks.push({ id: "t2", status: "queued" });
        delete db.somethingElse;
        return "done";
      });
      assert.equal(result, "done");
      const after = await store.read();
      assert.deepEqual(after.works.map((item) => [item.id, item.title, item.rowVersion]), [["b", "B", 1], ["a", "A2", 2]]);
      assert.deepEqual(after.tasks.map((task) => task.id), ["t1", "t2"]);
      assert.equal(after.somethingElse, undefined);
      assert.equal(after.storeRevision, 2);

      await assert.rejects(store.transact(() => { throw new Error("stop"); }), /stop/);
      assert.equal((await store.read()).storeRevision, 2);
    } finally { await stop(); }
  });

  test(`${name}: stories are listed by owner, read one at a time and changed atomically`, async () => {
    const { store, stop } = await open();
    try {
      await store.write({ schemaVersion: 6, works: [work("mine"), work("theirs", { ownerId: "u2" }), { id: "legacy", title: "L", chapters: [] }] });
      assert.deepEqual((await store.listWorks("u1")).map((item) => item.id), ["mine"]);
      assert.deepEqual((await store.listWorks("local")).map((item) => item.id), ["legacy"]);
      assert.equal((await store.getWork("theirs")).title, "THEIRS");

      assert.equal(await store.transactWork("mine", (item) => { item.title = "Mine"; return item.title; }), "Mine");
      const mine = await store.getWork("mine");
      assert.deepEqual([mine.title, mine.rowVersion, mine.structureRevision], ["Mine", 2, 2]);
      await store.transactWork("mine", () => {});
      assert.equal((await store.getWork("mine")).rowVersion, 2, "an unchanged story keeps its version");

      await assert.rejects(store.transactWork("missing", () => {}), { code: "WORK_NOT_FOUND" });
      await assert.rejects(store.transactWork("mine", (item) => { item.title = "lost"; throw new Error("stop"); }), /stop/);
      assert.equal((await store.getWork("mine")).title, "Mine");
      assert.throws(() => store.transactWork("mine"), TypeError);
    } finally { await stop(); }
  });

  test(`${name}: saveWorks checks the version each story was read at`, async () => {
    const { store, stop } = await open();
    try {
      await store.write({ schemaVersion: 6, works: [work("old")] });
      const [created] = await store.saveWorks({ upserts: [{ work: work("new"), expectedVersion: null }] });
      assert.equal(created.rowVersion, 1);
      assert.deepEqual((await store.read()).works.map((item) => item.id), ["new", "old"], "new stories go first");
      await assert.rejects(store.saveWorks({ upserts: [{ work: work("new"), expectedVersion: null }] }), { code: "WORK_UPDATED_ELSEWHERE" });

      const first = await store.getWork("old"), second = await store.getWork("old");
      const [saved] = await store.saveWorks({ upserts: [{ work: { ...first, title: "Old 2" }, expectedVersion: first.rowVersion }] });
      assert.deepEqual([saved.rowVersion, saved.structureRevision], [2, 2]);
      await assert.rejects(store.saveWorks({
        upserts: [{ work: work("never"), expectedVersion: null }, { work: { ...second, title: "Old 3" }, expectedVersion: second.rowVersion }]
      }), { code: "WORK_UPDATED_ELSEWHERE" });
      assert.equal(await store.getWork("never"), null, "nothing of a refused save is stored");
      assert.equal((await store.getWork("old")).title, "Old 2");

      await assert.rejects(store.saveWorks({ removals: [{ id: "old", expectedVersion: 1 }] }), { code: "WORK_UPDATED_ELSEWHERE" });
      await store.saveWorks({ removals: [{ id: "old", expectedVersion: 2 }] });
      assert.deepEqual((await store.read()).works.map((item) => item.id), ["new"]);
    } finally { await stop(); }
  });

  test(`${name}: records and documents change by collection`, async () => {
    const { store, stop } = await open();
    try {
      assert.equal(await store.transactRecords("tasks", (tasks) => { tasks.push({ id: "t1", status: "queued" }, { id: "t2", status: "queued" }); return tasks.length; }), 2);
      await store.transactRecords("tasks", (tasks) => { tasks[0].status = "completed"; tasks.splice(1, 1); tasks.push({ id: "t3", status: "queued" }); });
      assert.deepEqual(await store.readRecords("tasks"), [{ id: "t1", status: "completed" }, { id: "t3", status: "queued" }]);
      assert.deepEqual(await store.readRecords("usage"), []);
      await assert.rejects(store.transactRecords("tasks", (tasks) => { tasks.length = 0; throw new Error("stop"); }), /stop/);
      assert.equal((await store.readRecords("tasks")).length, 2);

      assert.deepEqual(await store.transactDocument("userPreferences", "u1", (current) => ({ ...(current || {}), theme: "candle" })), { theme: "candle" });
      await store.transactDocument("userPreferences", "u1", (current) => ({ ...current, uiLocale: "zh-CN" }));
      await store.transactDocument("settings", "dailyTokenLimit", () => 5);
      assert.deepEqual(await store.readDocument("userPreferences", "u1"), { theme: "candle", uiLocale: "zh-CN" });
      assert.equal(await store.readDocument("settings", "dailyTokenLimit"), 5);
      const database = await store.read();
      assert.deepEqual(database.userPreferences, { u1: { theme: "candle", uiLocale: "zh-CN" } });
      assert.deepEqual(database.tasks.map((task) => task.id), ["t1", "t3"]);

      assert.throws(() => store.transactRecords("works", () => {}), TypeError);
      await assert.rejects(store.readRecords("secrets"), TypeError);
      await assert.rejects(store.readDocument("tasks", "x"), TypeError);
    } finally { await stop(); }
  });

  test(`${name}: writes from parallel callers are applied one at a time`, async () => {
    const { store, stop } = await open();
    try {
      await store.write({ schemaVersion: 6, works: [work("w", { counter: 0 })] });
      await Promise.all(Array.from({ length: 12 }, (_, index) => index % 2
        ? store.transactWork("w", (item) => { item.counter += 1; })
        : store.transactRecords("usage", (usage) => { usage.push({ id: `u${index}` }); })));
      assert.equal((await store.getWork("w")).counter, 6);
      assert.equal((await store.readRecords("usage")).length, 6);
      assert.equal((await store.read()).storeRevision, 13);
    } finally { await stop(); }
  });
}

test("postgres: tables live outside the published schema, with row level security on", async () => {
  const server = await startPostgres();
  const store = createPostgresStore({ createPool: () => poolFromEnvironment({ DATABASE_URL: server.url }) });
  try {
    await store.ready();
    await store.ready();
    const pool = poolFromEnvironment({ DATABASE_URL: server.url });
    const { rows } = await pool.query("select tablename, rowsecurity from pg_tables where schemaname = 'novel_studio' order by tablename");
    assert.deepEqual(rows.map((row) => [row.tablename, row.rowsecurity]), [["schema_migrations", true], ["store_documents", true], ["store_meta", true], ["store_records", true], ["works", true]]);
    assert.equal((await pool.query("select count(*)::int as n from pg_tables where schemaname = 'public'")).rows[0].n, 0);
    assert.deepEqual((await pool.query("select version from novel_studio.schema_migrations")).rows, [{ version: 1 }]);
    await pool.end();
  } finally { await store.close(); await server.stop(); }
});

test("postgres: connection settings never need the string to be shown, and TLS is on for remote hosts", () => {
  assert.equal(sslOptions({}, "127.0.0.1"), false);
  assert.deepEqual(sslOptions({}, "aws-0-eu-central-1.pooler.supabase.com"), { rejectUnauthorized: true });
  assert.deepEqual(sslOptions({ DATABASE_SSL: "no-verify" }, "db.example.com"), { rejectUnauthorized: false });
  assert.throws(() => poolFromEnvironment({}), /DATABASE_URL is not set/);
  assert.throws(() => poolFromEnvironment({ DATABASE_URL: "not a url" }), (error) => /not a valid URL/.test(error.message) && !/not a url/.test(error.message));
});
