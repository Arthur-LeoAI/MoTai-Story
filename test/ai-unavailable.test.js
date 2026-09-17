const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "motai-ai-unavailable-"));
process.env.DATA_FILE = path.join(directory, "db.json");
process.env.ENV_FILE = path.join(directory, ".env.local");
process.env.AI_PROVIDER = "deepseek";
delete process.env.MOTAI_TEST_AI;
delete process.env.OPENAI_API_KEY;
delete process.env.OPENAI_KEY;

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

async function jsonRequest(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  return { response, payload: await response.json() };
}

test("missing API configuration is reported and never produces preset writing", async () => {
  const status = await jsonRequest("/api/ai/test", { method: "POST", body: "{}" });
  assert.equal(status.response.status, 200);
  assert.equal(status.payload.ok, false);
  assert.match(status.payload.message, /运行环境配置/);

  const created = await jsonRequest("/api/works", {
    method: "POST",
    body: JSON.stringify({ title: "测试作品" })
  });
  const writing = await jsonRequest("/api/ai/write", {
    method: "POST",
    body: JSON.stringify({
      mode: "continue",
      workId: created.payload.work.id,
      chapterId: created.payload.work.chapters[0].id,
      baseChapterUpdatedAt: created.payload.work.chapters[0].updatedAt
    })
  });
  assert.equal(writing.response.status, 503);
  assert.match(writing.payload.error, /AI 不可用/);
  assert.equal(Object.hasOwn(writing.payload, "text"), false);
});
