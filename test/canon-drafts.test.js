const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "canon-drafts-"));
process.env.DATA_FILE = path.join(dir, "db.json");
process.env.ENV_FILE = path.join(dir, ".env");
process.env.MOTAI_TEST_AI = "1";

const drafts = require("../src/canon-drafts");
const { normalizeCanon } = require("../src/continuity");
const { createAppServer } = require("../server");

const server = createAppServer();
let base;
test.before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fsp.rm(dir, { recursive: true, force: true });
});

async function call(url, method = "GET", data) {
  const response = await fetch(base + url, { method, headers: { "Content-Type": "application/json" }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const text = await response.text();
  return { status: response.status, body: text.startsWith("{") ? JSON.parse(text) : text };
}

const story = (language) => ({
  language,
  title: language === "en" ? "The Cartographer's Sister" : "雾港来信",
  premise: "A mapmaker receives an unsigned map.",
  canon: normalizeCanon({ entities: [{ id: "mira", type: "character", name: "Mira", aliases: ["the cartographer"], summary: "A mapmaker on the run" }] })
});

test("the sketch request carries the writer's sentence, the story, the cast, and the story's language", () => {
  const english = drafts.characterDraftRequest(story("en"), { description: "Kael, her oldest friend, now a warden", conversation: "Author: Who hunts her?" });
  assert.ok(english.prompt.includes("Kael, her oldest friend, now a warden"));
  assert.ok(english.prompt.includes("Mira (also called the cartographer): A mapmaker on the run"));
  assert.ok(english.prompt.includes("Author: Who hunts her?"));
  assert.match(english.prompt, /leave the rest empty rather than inventing/);
  assert.match(english.prompt, /Write in English/);
  assert.deepEqual(english.required, ["name", "summary", "want", "obstacle", "change", "appearance", "voice", "secret", "background"]);
  const chinese = drafts.characterDraftRequest(story("zh-CN"), { description: "老陈，渡船船长" });
  assert.match(chinese.prompt, /没有依据的字段留空，不要编造/);
  assert.match(chinese.prompt, /用简体中文/);
});

test("a draft keeps only card fields, and a draft without a name is refused", () => {
  const draft = drafts.normalizeCharacterDraft({ name: "  Kael ", summary: "A warden", want: "To keep his oath", aliases: ["Kael", "the warden", ""], extra: "ignored", secret: 7 });
  assert.deepEqual(draft, { name: "Kael", aliases: ["the warden"], summary: "A warden", card: { want: "To keep his oath", obstacle: "", change: "", appearance: "", voice: "", secret: "", background: "" }, notes: "" });
  assert.throws(() => drafts.normalizeCharacterDraft({ summary: "no name" }), { code: "AI_ARTIFACT_EMPTY" });
});

test("new people are never offered twice, nor anyone already in the cast", () => {
  const work = story("en");
  const found = drafts.normalizeCandidates({ characters: [{ name: "MIRA", summary: "" }, { name: "the cartographer" }, { name: "Kael", summary: "A warden" }, { name: "kael" }, { name: "" }, ...Array.from({ length: 10 }, (_, index) => ({ name: `Person${index}` }))] }, work);
  assert.deepEqual(found.slice(0, 1), [{ name: "Kael", summary: "A warden" }]);
  assert.equal(found.length, drafts.MAX_CANDIDATES);
  const request = drafts.candidatesRequest(work, "Author: Maybe a warden called Kael.");
  assert.match(request.prompt, /Already in the cast \(leave these out\): mira, the cartographer/);
  assert.match(request.prompt, /An empty list is a good answer/);
});

test("HTTP: a sketched character is only a draft until the writer saves it", async () => {
  const { body: { work } } = await call("/api/works", "POST", { title: "Drafts", language: "en" });
  const refused = await call(`/api/works/${work.id}/canon/drafts/character`, "POST", { description: "  " });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error.code, "DRAFT_DESCRIPTION_REQUIRED");

  const sketched = await call(`/api/works/${work.id}/canon/drafts/character`, "POST", { description: "Kael, her oldest friend, now a warden" });
  assert.equal(sketched.status, 200);
  assert.equal(sketched.body.draft.name, "Kael");
  assert.equal(sketched.body.draft.summary, "Kael, her oldest friend, now a warden");
  assert.deepEqual((await call(`/api/works/${work.id}/canon`)).body.canon.entities, []);
});

test("HTTP: new people in a conversation are found once and drop out once they are in the cast", async () => {
  const { body: { work } } = await call("/api/works", "POST", { title: "Capture", language: "en" });
  const { body: { chats } } = await call(`/api/works/${work.id}/chats`);
  const chatId = chats[0].id;
  const streamed = await call(`/api/works/${work.id}/chats/${chatId}/messages/stream`, "POST", { content: "Who should stand in her way? Maybe a warden called Kael." });
  assert.equal(streamed.status, 200);
  const reply = (await call(`/api/works/${work.id}/chats`)).body.chats[0].messages.find((message) => message.role === "assistant");
  const path = `/api/works/${work.id}/chats/${chatId}/messages/${reply.id}/cast-candidates`;

  const first = await call(path, "POST", {});
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.candidates.map((item) => item.name), ["Kael"]);
  // Kept on the message, so the conversation keeps it after a reload.
  const stored = (await call(`/api/works/${work.id}/chats`)).body.chats[0].messages.find((message) => message.id === reply.id);
  assert.deepEqual(stored.castCandidates.map((item) => item.name), ["Kael"]);

  await call(`/api/works/${work.id}/canon/entities`, "POST", { type: "character", name: "Kael" });
  assert.deepEqual((await call(path, "POST", {})).body.candidates, []);

  const userMessage = (await call(`/api/works/${work.id}/chats`)).body.chats[0].messages.find((message) => message.role === "user");
  assert.equal((await call(`/api/works/${work.id}/chats/${chatId}/messages/${userMessage.id}/cast-candidates`, "POST", {})).status, 404);
  assert.equal((await call(`/api/works/${work.id}/chats/missing/messages/${reply.id}/cast-candidates`, "POST", {})).body.error.code, "CHAT_NOT_FOUND");
});
