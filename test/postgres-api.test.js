// The whole application on the Postgres backend (an in-process PostgreSQL,
// never a real database): the main flows a writer uses, end to end over HTTP.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "postgres-api-"));
process.env.DATA_FILE = path.join(dir, "db.json");
process.env.ENV_FILE = path.join(dir, ".env");
process.env.MOTAI_TEST_AI = "1";
process.env.NOVEL_STUDIO_STORAGE = "postgres";

const { startPostgres } = require("./pglite-server");
const { createAppServer } = require("../server");

const server = createAppServer();
let base;
let database;
test.before(async () => {
  database = await startPostgres();
  // Read on first use, so the database can start after the server is built.
  process.env.DATABASE_URL = database.url;
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await database.stop();
  delete process.env.NOVEL_STUDIO_STORAGE;
  delete process.env.DATABASE_URL;
  await fsp.rm(dir, { recursive: true, force: true });
});

async function call(url, method = "GET", data) {
  const response = await fetch(base + url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) })
  });
  return { status: response.status, body: await response.json() };
}

async function finished(taskId) {
  for (;;) {
    const { body } = await call(`/api/tasks/${taskId}`);
    if (["completed", "failed", "cancelled", "interrupted"].includes(body.task.status)) return body.task;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test("stories, chapters, canon, generation, preferences, import, backup and restore run on Postgres", async () => {
  const session = await call("/api/session");
  assert.equal(session.status, 200);
  assert.equal(session.body.user.id, "local");

  const created = await call("/api/works", "POST", { title: "Fog Harbour", language: "en" });
  assert.equal(created.status, 201);
  const { work } = created.body;
  const listed = await call("/api/works");
  assert.deepEqual(listed.body.works.map((item) => item.id), [work.id]);

  const renamed = await call(`/api/works/${work.id}`, "PATCH", { premise: "A mapmaker searches for her sister." });
  assert.equal(renamed.status, 200);
  assert.equal((await call(`/api/works/${work.id}`)).body.work.premise, "A mapmaker searches for her sister.");

  // Chapter edits are versioned; a stale save is refused.
  const chapter = work.chapters[0];
  const root = `/api/works/${work.id}/chapters/${chapter.id}`;
  const saved = await call(root, "PATCH", { baseRevision: chapter.revision, content: "Mira unfolded the map." });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.chapter.revision, chapter.revision + 1);
  assert.equal((await call(root, "PATCH", { baseRevision: chapter.revision, content: "stale" })).body.error.code, "REVISION_CONFLICT");

  // Structured story data.
  const mira = await call(`/api/works/${work.id}/canon/entities`, "POST", { type: "character", name: "Mira", summary: "A mapmaker on the run" });
  assert.equal(mira.status, 201);
  assert.equal((await call(`/api/works/${work.id}/canon`)).body.canon.entities[0].name, "Mira");

  // A suggestion from the (test) AI, added to the chapter, then reviewed.
  const queued = await call("/api/tasks", "POST", { requestId: "pg-flow", workId: work.id, chapterId: chapter.id, baseRevision: saved.body.chapter.revision, mode: "continue", range: { index: 22, length: 0 } });
  assert.equal(queued.status, 202);
  const task = await finished(queued.body.task.id);
  assert.equal(task.status, "completed", task.message);
  const record = task.result.generation;
  assert.ok(record.context.canonFactIds.includes(`derived:entity:${mira.body.item.id}`));
  const merged = await call(`${root}/generations/${record.id}/merge`, "POST", { baseRevision: saved.body.chapter.revision, hunkIds: [record.hunks[0].id] });
  assert.equal(merged.status, 200, JSON.stringify(merged.body));
  assert.equal((await finished(merged.body.reviewTask.id)).status, "completed");
  assert.ok((await call("/api/tasks")).body.tasks.length >= 2);
  assert.equal((await call("/api/usage")).status, 200);

  // Per-user preferences.
  const preferences = await call("/api/me/preferences", "PATCH", { theme: "candle", uiLocale: "zh-CN" });
  assert.equal(preferences.status, 200);
  assert.deepEqual([preferences.body.preferences.theme, preferences.body.preferences.uiLocale], ["candle", "zh-CN"]);
  assert.equal((await call("/api/me/preferences")).body.preferences.theme, "candle");

  // Importing a manuscript; confirming twice still makes one story.
  const preview = await call("/api/imports", "POST", { fileName: "harbour.txt", base64: Buffer.from("Chapter 1\nThe bell rang.\nChapter 2\nThe ferry came.", "utf8").toString("base64") });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  const confirmed = await call(`/api/imports/${preview.body.preview.id}/confirm`, "POST", { title: "Imported harbour", language: "en" });
  assert.equal(confirmed.status, 201, JSON.stringify(confirmed.body));
  const again = await call(`/api/imports/${preview.body.preview.id}/confirm`, "POST", { title: "Imported harbour", language: "en" });
  assert.equal(again.body.work.id, confirmed.body.work.id);
  assert.equal((await call("/api/works")).body.works.length, 2);

  // Backup, delete, restore.
  const backup = await call("/api/backup");
  assert.equal(backup.status, 200);
  assert.equal((await call(`/api/works/${work.id}`, "DELETE")).status, 200);
  assert.equal((await call("/api/works")).body.works.length, 1);
  const restored = await call("/api/backup/restore", "POST", backup.body);
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  const back = (await call(`/api/works/${work.id}`)).body.work;
  assert.equal(back.premise, "A mapmaker searches for her sister.");
  assert.equal(back.canon.entities[0].name, "Mira");
  assert.match(back.chapters[0].content, /^Mira unfolded the map\./);
});
