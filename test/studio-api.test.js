const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "motai-studio-api-"));
process.env.DATA_FILE = path.join(directory, "db.json");
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

test("生成记录不能写入同作品的其他章节，即使两章正文相同", async () => {
  const created = await jsonRequest("/api/works", { method: "POST", body: JSON.stringify({ title: "章节绑定保护" }) });
  const workId = created.payload.work.id;
  const source = created.payload.work.chapters[0];
  const targetResult = await jsonRequest(`/api/works/${workId}/chapters`, { method: "POST", body: JSON.stringify({ title: "第二章" }) });
  assert.equal(targetResult.response.status, 201);
  const target = targetResult.payload.chapter;
  assert.equal(target.content, source.content);
  const generated = await jsonRequest("/api/ai/write", {
    method: "POST", body: JSON.stringify({ workId, chapterId: source.id, mode: "continue" })
  });
  assert.equal(generated.response.status, 200);
  assert.equal(generated.payload.canAccept, true);
  const richContent = { version: 1, ops: [{ insert: `${generated.payload.text}\n` }] };
  const wrongChapter = await jsonRequest(`/api/works/${workId}/chapters/${target.id}/generations/${generated.payload.generation.id}/accept`, {
    method: "POST", body: JSON.stringify({ baseChapterUpdatedAt: target.updatedAt, richContent })
  });
  assert.equal(wrongChapter.response.status, 404);
  const saved = (await jsonRequest(`/api/works/${workId}`)).payload.work;
  assert.equal(saved.chapters.find((item) => item.id === target.id).content, target.content);
  assert.equal(saved.generationRecords.find((item) => item.id === generated.payload.generation.id).status, "ready");
  const correctChapter = await jsonRequest(`/api/works/${workId}/chapters/${source.id}/generations/${generated.payload.generation.id}/accept`, {
    method: "POST", body: JSON.stringify({ baseChapterUpdatedAt: source.updatedAt, richContent })
  });
  assert.equal(correctChapter.response.status, 200);
  assert.equal(correctChapter.payload.generation.status, "accepted");
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fsp.rm(directory, { recursive: true, force: true });
});

async function jsonRequest(pathname, options = {}) {
  options = await require("./versioned-request").versionedOptions(baseUrl, pathname, options);
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers }
  });
  return { response, payload: await response.json() };
}

test("new studio supports chats, streaming, proposals and rich chapters", async () => {
  const created = await jsonRequest("/api/works", {
    method: "POST",
    body: JSON.stringify({ title: "雾港来信", premise: "学徒收到来自未来的求救信号。" })
  });
  assert.equal(created.response.status, 201);
  const workId = created.payload.work.id;
  const chapterId = created.payload.work.chapters[0].id;

  const chats = await jsonRequest(`/api/works/${workId}/chats`);
  assert.equal(chats.response.status, 200);
  assert.equal(chats.payload.chats.length, 1);
  const chatId = chats.payload.activeChatId;

  const streamResponse = await fetch(`${baseUrl}/api/works/${workId}/chats/${chatId}/messages/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "帮我梳理人物关系" })
  });
  assert.equal(streamResponse.status, 200);
  assert.match(streamResponse.headers.get("content-type"), /text\/event-stream/);
  const stream = await streamResponse.text();
  assert.match(stream, /event: meta/);
  assert.match(stream, /event: delta/);
  assert.match(stream, /event: done/);

  const proposalResponse = await jsonRequest(`/api/works/${workId}/chats/${chatId}/proposals`, {
    method: "POST",
    body: JSON.stringify({ type: "outline" })
  });
  assert.equal(proposalResponse.response.status, 201);
  const proposal = proposalResponse.payload.proposal;
  assert.equal(proposal.status, "pending");
  assert.ok(proposal.sections.length > 0);

  const firstKey = proposal.sections[0].key;
  const applied = await jsonRequest(`/api/works/${workId}/proposals/${proposal.id}/apply`, {
    method: "POST",
    body: JSON.stringify({ sectionKeys: [firstKey] })
  });
  assert.equal(applied.response.status, 200);
  assert.deepEqual(applied.payload.appliedKeys, [firstKey]);

  const reverted = await jsonRequest(`/api/works/${workId}/proposals/${proposal.id}/revert`, {
    method: "POST",
    body: "{}"
  });
  assert.equal(reverted.response.status, 200);
  assert.equal(reverted.payload.proposal.status, "reverted");

  const chapterUpdate = await jsonRequest(`/api/works/${workId}/chapters/${chapterId}`, {
    method: "PATCH",
    body: JSON.stringify({
      richContent: {
        version: 1,
        ops: [
          { insert: "雾港" },
          { insert: "\n", attributes: { header: 2 } },
          { insert: "第一段正文\n" }
        ]
      }
    })
  });
  assert.equal(chapterUpdate.response.status, 200);
  assert.equal(chapterUpdate.payload.chapter.content, "## 雾港\n第一段正文");
  assert.equal(chapterUpdate.payload.chapter.contentFormat, "quill-delta-v1");

  const firstContinuation = await jsonRequest("/api/ai/write", {
    method: "POST",
    body: JSON.stringify({
      mode: "continue",
      instruction: "让未来信号带来新的行动压力",
      workId,
      chapterId,
      baseChapterUpdatedAt: chapterUpdate.payload.chapter.updatedAt
    })
  });
  assert.equal(firstContinuation.response.status, 200);
  assert.equal(firstContinuation.payload.fallback, false);
  assert.equal(firstContinuation.payload.canAccept, true);

  const accepted = await jsonRequest(`/api/works/${workId}/chapters/${chapterId}/generations/${firstContinuation.payload.generation.id}/accept`, {
    method: "POST",
    body: JSON.stringify({
      baseChapterUpdatedAt: chapterUpdate.payload.chapter.updatedAt,
      richContent: { version: 1, ops: [{ insert: `${chapterUpdate.payload.chapter.content}\n\n${firstContinuation.payload.text}\n` }] }
    })
  });
  assert.equal(accepted.response.status, 200);
  assert.equal(accepted.payload.generation.status, "accepted");

  const secondContinuation = await jsonRequest("/api/ai/write", {
    method: "POST",
    body: JSON.stringify({
      mode: "continue",
      instruction: "让未来信号带来新的行动压力",
      workId,
      chapterId,
      baseChapterUpdatedAt: accepted.payload.chapter.updatedAt
    })
  });
  assert.equal(secondContinuation.response.status, 200);
  assert.notEqual(secondContinuation.payload.text, firstContinuation.payload.text);
});
