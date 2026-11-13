const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "motai-backup-"));
const dataFile = path.join(directory, "db.json");
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="18"><rect width="12" height="18" fill="#123456"/></svg>';

fs.writeFileSync(dataFile, JSON.stringify({
  works: [
    {
      id: "work_backup",
      title: "备份中的小说",
      cover: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
      chapters: [{ id: "chapter_backup", title: "第一章", content: "恢复前的正文", status: "draft" }]
    }
  ]
}), "utf8");

process.env.DATA_FILE = dataFile;
process.env.ENV_FILE = path.join(directory, ".env.local");
process.env.MOTAI_TEST_AI = "1";

const { createAppServer } = require("../server");
const server = createAppServer();
let baseUrl = "";

test.before(async () => {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fsp.rm(directory, { recursive: true, force: true });
});

async function request(pathname, options = {}) {
  options = await require("./versioned-request").versionedOptions(baseUrl, pathname, options);
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers }
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

test("完整备份包含作品和本地封面，恢复前会留下回退快照", async () => {
  const original = await request("/api/works");
  const work = original.payload.works[0];
  const chapter = (await request(`/api/works/${work.id}`)).payload.work.chapters[0];
  const illustration = await request(`/api/works/${work.id}/chapters/${chapter.id}/images/upload`, {
    method: "POST",
    body: JSON.stringify({
      caption: "备份插图",
      image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL3HwAAAABJRU5ErkJggg=="
    })
  });
  assert.equal(illustration.response.status, 201);
  await request(`/api/works/${work.id}/chapters/${chapter.id}`, {
    method: "PATCH",
    body: JSON.stringify({ content: illustration.payload.markdown })
  });

  const backupResponse = await fetch(`${baseUrl}/api/backup`);
  assert.equal(backupResponse.status, 200);
  assert.match(backupResponse.headers.get("content-disposition"), /-backup-\d{14}\.json/i);
  const backup = await backupResponse.json();
  assert.equal(backup.format, `${require("../shared/brand.json").codename}-backup`);
  assert.equal(backup.version, 1);
  assert.equal(backup.database.works.length, 1);
  assert.equal(Object.keys(backup.covers).length, 2);
  assert.equal(JSON.stringify(backup).includes("OPENAI_API_KEY"), false);

  const created = await request("/api/works", {
    method: "POST",
    body: JSON.stringify({ title: "临时作品" })
  });
  assert.equal(created.response.status, 201);

  const restored = await request("/api/backup/restore", {
    method: "POST",
    body: JSON.stringify(backup)
  });
  assert.equal(restored.response.status, 200);
  assert.equal(restored.payload.workCount, 1);
  assert.equal(restored.payload.coverCount, 2);
  assert.match(restored.payload.previousBackup, /before-restore-\d{14}\.backup\.json$/);

  const listed = await request("/api/works");
  assert.deepEqual(listed.payload.works.map((work) => work.title), ["备份中的小说"]);
  assert.match(listed.payload.works[0].cover, /^\/data\/covers\/restore-/);
  const restoredWork = await request(`/api/works/${listed.payload.works[0].id}`);
  assert.match(restoredWork.payload.work.chapters[0].content, /\/data\/covers\/restore-/);
  const backups = await fsp.readdir(path.join(directory, "backups"));
  assert.ok(backups.length >= 1);
  assert.ok(backups.some((name) => name.startsWith(`${require("../shared/brand.json").codename}-before-restore-`)));
});

test("无效备份不会替换当前作品库", async () => {
  const before = await request("/api/works");
  const failed = await request("/api/backup/restore", {
    method: "POST",
    body: JSON.stringify({ format: "other", version: 1, database: { works: [] } })
  });

  assert.equal(failed.response.status, 400);
  const after = await request("/api/works");
  assert.deepEqual(after.payload.works, before.payload.works);
});

test("backups made before the rename still restore", async () => {
  const fresh = await request("/api/backup");
  const legacy = { ...fresh.payload, format: "motai-backup" };
  const restored = await request("/api/backup/restore", { method: "POST", body: JSON.stringify(legacy) });
  assert.equal(restored.response.status, 200);
});
