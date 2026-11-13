const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");

const { createJsonStore } = require("../src/storage");

test("JSON store initializes missing data and persists valid JSON", async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "motai-store-"));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));

  const filePath = path.join(directory, "data", "db.json");
  const store = createJsonStore(filePath);

  assert.deepEqual(await store.read(), { schemaVersion: 0, works: [] });

  const work = { id: "work_1", title: "测试作品" };
  await store.write({ works: [work] });
  assert.deepEqual(await store.read(), { schemaVersion: 0, storeRevision: 1, works: [work] });

  const parsed = JSON.parse(await fsp.readFile(filePath, "utf8"));
  assert.deepEqual(parsed, { schemaVersion: 0, storeRevision: 1, works: [work] });
});

test("JSON store serializes queued writes", async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "motai-queue-"));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));

  const store = createJsonStore(path.join(directory, "db.json"));
  const first = store.write({ works: [{ id: "first" }] });
  const second = store.write({ works: [{ id: "second" }] });
  await Promise.all([first, second]);

  assert.deepEqual(await store.read(), { schemaVersion: 0, storeRevision: 2, works: [{ id: "second" }] });
});

test("JSON store preserves schema version and transactions do not lose concurrent updates", async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "motai-transaction-"));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));

  const store = createJsonStore(path.join(directory, "db.json"));
  await store.write({ schemaVersion: 2, works: [] });
  await Promise.all([
    store.transact(async (database) => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      database.works.push({ id: "work-a" });
    }),
    store.transact((database) => {
      database.works.push({ id: "work-b" });
    })
  ]);

  const database = await store.read();
  assert.equal(database.schemaVersion, 2);
  assert.deepEqual(database.works.map((work) => work.id), ["work-a", "work-b"]);
});

test("story-by-story access: list by owner, get one, and change one atomically", async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "motai-store-works-"));
  const store = createJsonStore(path.join(directory, "db.json"));
  await store.write({ schemaVersion: 2, works: [{ id: "mine", ownerId: "u1", title: "A" }, { id: "legacy", title: "B" }, { id: "theirs", ownerId: "u2", title: "C" }] });

  assert.deepEqual((await store.listWorks("u1")).map((work) => work.id), ["mine"]);
  assert.deepEqual((await store.listWorks("local")).map((work) => work.id), ["legacy"]);
  assert.equal((await store.getWork("theirs")).title, "C");
  assert.equal(await store.getWork("missing"), null);

  const result = await store.transactWork("mine", (work) => { work.title = "A2"; return work.title; });
  assert.equal(result, "A2");
  assert.equal((await store.getWork("mine")).title, "A2");
  assert.equal((await store.getWork("theirs")).title, "C");

  await assert.rejects(store.transactWork("missing", () => {}), { code: "WORK_NOT_FOUND" });
  await assert.rejects(store.transactWork("mine", (work) => { work.title = "lost"; throw new Error("stop"); }), /stop/);
  assert.equal((await store.getWork("mine")).title, "A2");
  assert.throws(() => store.transactWork("mine"), TypeError);
  await fsp.rm(directory, { recursive: true, force: true });
});

test("saveWorks: every stored change moves a story's rowVersion, and a stale save is refused whole", async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "motai-store-save-"));
  const store = createJsonStore(path.join(directory, "db.json"));
  await store.write({ schemaVersion: 6, works: [] });

  const [created] = await store.saveWorks({ upserts: [{ work: { id: "a", title: "A", chapters: [] }, expectedVersion: null }] });
  assert.equal(created.rowVersion, 1);
  await assert.rejects(store.saveWorks({ upserts: [{ work: { id: "a", title: "again", chapters: [] }, expectedVersion: null }] }), { code: "WORK_UPDATED_ELSEWHERE" });

  // Two readers of version 1; the first save wins.
  const first = await store.getWork("a"), second = await store.getWork("a");
  const [saved] = await store.saveWorks({ upserts: [{ work: { ...first, title: "A1" }, expectedVersion: first.rowVersion }] });
  assert.equal(saved.rowVersion, 2);
  await store.saveWorks({ upserts: [{ work: { id: "b", title: "B", chapters: [] }, expectedVersion: null }] });
  await assert.rejects(store.saveWorks({
    upserts: [{ work: { id: "c", title: "C", chapters: [] }, expectedVersion: null }, { work: { ...second, title: "A2" }, expectedVersion: second.rowVersion }]
  }), { code: "WORK_UPDATED_ELSEWHERE" });
  assert.equal(await store.getWork("c"), null, "nothing of a refused save is stored");
  assert.equal((await store.getWork("a")).title, "A1");

  // A change made through a transaction moves the version too; an unchanged one does not.
  await store.transactWork("a", () => {});
  assert.equal((await store.getWork("a")).rowVersion, 2);
  await store.transactWork("a", (work) => { work.notes = "x"; });
  assert.equal((await store.getWork("a")).rowVersion, 3);

  await assert.rejects(store.saveWorks({ removals: [{ id: "a", expectedVersion: 2 }] }), { code: "WORK_UPDATED_ELSEWHERE" });
  await store.saveWorks({ removals: [{ id: "a", expectedVersion: 3 }] });
  assert.deepEqual((await store.read()).works.map((work) => work.id), ["b"]);
  await fsp.rm(directory, { recursive: true, force: true });
});

test("records and documents outside stories are read and changed by collection", async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "motai-store-records-"));
  const store = createJsonStore(path.join(directory, "db.json"));

  assert.deepEqual(await store.readRecords("tasks"), []);
  assert.equal(await store.readDocument("userPreferences", "u1"), null);

  const added = await store.transactRecords("tasks", (tasks) => { tasks.push({ id: "t1", status: "queued" }); return tasks.length; });
  assert.equal(added, 1);
  await store.transactRecords("tasks", (tasks) => { tasks[0].status = "completed"; });
  assert.deepEqual(await store.readRecords("tasks"), [{ id: "t1", status: "completed" }]);
  assert.deepEqual(await store.readRecords("usage"), []);
  await assert.rejects(store.transactRecords("tasks", (tasks) => { tasks.length = 0; throw new Error("stop"); }), /stop/);
  assert.equal((await store.readRecords("tasks")).length, 1);

  const saved = await store.transactDocument("userPreferences", "u1", (current) => ({ ...(current || {}), theme: "candle" }));
  assert.deepEqual(saved, { theme: "candle" });
  await store.transactDocument("userPreferences", "u2", () => ({ theme: "paper" }));
  await store.transactDocument("settings", "dailyTokenLimit", () => 5);
  assert.deepEqual(await store.readDocument("userPreferences", "u1"), { theme: "candle" });
  assert.equal(await store.readDocument("settings", "dailyTokenLimit"), 5);
  // The file keeps the layout older code and backups expect.
  const file = await store.read();
  assert.deepEqual(file.userPreferences, { u1: { theme: "candle" }, u2: { theme: "paper" } });
  assert.deepEqual(file.settings, { dailyTokenLimit: 5 });

  assert.throws(() => store.transactRecords("works", () => {}), TypeError);
  await assert.rejects(store.readRecords("secrets"), TypeError);
  await assert.rejects(store.readDocument("tasks", "x"), TypeError);
  await fsp.rm(directory, { recursive: true, force: true });
});
