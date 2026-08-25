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

  assert.deepEqual(await store.read(), { works: [] });

  const work = { id: "work_1", title: "测试作品" };
  await store.write({ works: [work] });
  assert.deepEqual(await store.read(), { works: [work] });

  const parsed = JSON.parse(await fsp.readFile(filePath, "utf8"));
  assert.deepEqual(parsed, { works: [work] });
});

test("JSON store serializes queued writes", async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "motai-queue-"));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));

  const store = createJsonStore(path.join(directory, "db.json"));
  const first = store.write({ works: [{ id: "first" }] });
  const second = store.write({ works: [{ id: "second" }] });
  await Promise.all([first, second]);

  assert.deepEqual(await store.read(), { works: [{ id: "second" }] });
});
