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
