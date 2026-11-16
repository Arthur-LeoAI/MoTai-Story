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
  assert.match(request.prompt, /Already in the cast \(leave these out\): Mira, the cartographer/);
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

test("each chapter is read with the story's language, the names known so far, and a cap on its length", () => {
  const chapter = { id: "c1", title: "The Ferry", content: "Mira waited. ".repeat(2000) };
  const english = drafts.chapterExtractionRequest(story("en"), chapter, { index: 0, total: 3, knownNames: ["Mira", "the cartographer"] });
  assert.match(english.prompt, /Read chapter 1 of 3/);
  assert.match(english.prompt, /People already known \(use these names exactly when they appear\): Mira, the cartographer/);
  assert.match(english.prompt, /Leave anything out rather than guess\. Write in English\./);
  assert.equal(english.truncated, true);
  assert.ok(english.prompt.length < drafts.CHARS_PER_CHAPTER + 3000, "the chapter text is cut to the cap");
  assert.deepEqual(english.properties.relations.items.properties.kind.enum, ["family", "friend", "lover", "mentor", "rival", "enemy", "ally", "custom"]);
  const chinese = drafts.chapterExtractionRequest(story("zh-CN"), { id: "c1", title: "渡口", content: "林舟在渡口等着。" }, { index: 1, total: 2, knownNames: [] });
  assert.match(chinese.prompt, /第 2 章（共 2 章）/);
  assert.match(chinese.prompt, /拿不准的就不写，不要猜测。用简体中文。/);
  assert.equal(chinese.truncated, false);
});

test("chapters are merged into one card per person, never repeating the Cast", () => {
  const work = story("en");
  const read = [
    drafts.normalizeChapterExtraction({
      characters: [{ name: "Kael", aliases: ["the warden"], summary: "Her oldest friend" }, { name: "MIRA", summary: "already in Cast" }, { name: "" }],
      relations: [{ from: "Kael", to: "the cartographer", kind: "friend", tension: "He owes her" }, { from: "Kael", to: "kael", kind: "enemy" }, { from: "Kael", to: "Mira", kind: "nonsense" }],
      events: [{ title: "Kael finds her", participants: ["the warden", "Mira"], location: "Low Ford" }, { title: "" }]
    }, "c1"),
    drafts.normalizeChapterExtraction({
      characters: [{ name: "The Warden", summary: "", want: "To keep his oath" }, { name: "Voss", summary: "Governor" }],
      relations: [{ from: "Mira", to: "the warden", kind: "friend" }, { from: "Voss", to: "Kael", kind: "mentor" }],
      events: [{ title: "Voss gives the order", participants: ["Voss", "Kael"] }]
    }, "c2")
  ];
  const merged = drafts.mergeExtractions(work, read);
  assert.deepEqual(merged.characters.map((person) => [person.name, person.aliases, person.summary, person.card.want]), [
    ["Kael", ["the warden", "The Warden"], "Her oldest friend", "To keep his oath"],
    ["Voss", [], "Governor", ""]
  ]);
  // Names are given as each card's main name; the same pair and kind only once.
  assert.deepEqual(merged.relations.map((relation) => [relation.from, relation.to, relation.kind]), [["Kael", "Mira", "friend"], ["Kael", "Mira", "custom"], ["Voss", "Kael", "mentor"]]);
  assert.deepEqual(merged.events.map((event) => [event.chapterId, event.title, event.participants]), [["c1", "Kael finds her", ["Kael", "Mira"]], ["c2", "Voss gives the order", ["Voss", "Kael"]]]);
});

test("HTTP: reading the manuscript is a background task whose drafts change nothing until kept", async () => {
  const { body: { work: empty } } = await call("/api/works", "POST", { title: "Empty", language: "en" });
  const refused = await call(`/api/works/${empty.id}/canon/drafts/manuscript`, "POST", {});
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error.code, "MANUSCRIPT_EMPTY");

  const { body: { work } } = await call("/api/works", "POST", { title: "Ferry", language: "en" });
  const chapter = work.chapters[0];
  await call(`/api/works/${work.id}/chapters/${chapter.id}`, "PATCH", { baseRevision: chapter.revision, content: "Mira waited at the ferry, and then Kael came down the path." });
  const started = await call(`/api/works/${work.id}/canon/drafts/manuscript`, "POST", { requestId: `extract-${work.id}` });
  assert.equal(started.status, 202);
  let task = started.body.task;
  while (!["completed", "failed"].includes(task.status)) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    task = (await call(`/api/tasks/${task.id}`)).body.task;
  }
  assert.equal(task.status, "completed", task.message);
  assert.deepEqual(task.progress, { done: 1, total: 1 });
  assert.equal(task.result.chaptersRead, 1);
  assert.deepEqual(task.result.drafts.characters.map((person) => person.name), ["Kael"]);
  assert.equal(task.result.drafts.events[0].chapterId, chapter.id);
  assert.equal(task.result.drafts.events[0].chapterTitle, "Chapter 1");
  assert.deepEqual((await call(`/api/works/${work.id}/canon`)).body.canon.entities, []);
});

test("a person's own name is preferred over a title, in cards, relations and events", () => {
  const merged = drafts.mergeExtractions(story("en"), [
    drafts.normalizeChapterExtraction({ characters: [{ name: "the Governor", summary: "Burns maps" }], relations: [], events: [{ title: "Maps burn", participants: ["the Governor"] }] }, "c1"),
    drafts.normalizeChapterExtraction({ characters: [{ name: "Edric Voss", aliases: ["the Governor", "Governor Edric Voss"], summary: "" }, { name: "Pell", summary: "His secretary" }], relations: [{ from: "the Governor", to: "Pell", kind: "custom", label: "master and secretary" }], events: [] }, "c2")
  ]);
  assert.deepEqual(merged.characters.map((person) => [person.name, person.aliases]), [["Edric Voss", ["the Governor", "Governor Edric Voss"]], ["Pell", []]]);
  assert.deepEqual(merged.relations.map((relation) => [relation.from, relation.to]), [["Edric Voss", "Pell"]]);
  assert.deepEqual(merged.events[0].participants, ["Edric Voss"]);
  const request = drafts.chapterExtractionRequest(story("en"), { id: "c1", title: "", content: "x" }, { index: 0, total: 1, knownNames: [] });
  assert.match(request.prompt, /Groups, organisations, places and animals are not people/);
});

test("a title with or without an article is one person", () => {
  const merged = drafts.mergeExtractions(story("en"), [
    drafts.normalizeChapterExtraction({ characters: [{ name: "the Governor", summary: "Burns maps" }], relations: [], events: [] }, "c1"),
    drafts.normalizeChapterExtraction({ characters: [{ name: "Edric Voss", aliases: ["Governor"], summary: "Reads the report" }], relations: [], events: [] }, "c2")
  ]);
  assert.deepEqual(merged.characters.map((person) => person.name), ["Edric Voss"]);
  assert.equal(merged.characters[0].summary, "Burns maps");
  // Someone in the Cast is recognised the same way.
  assert.deepEqual(drafts.normalizeCandidates({ characters: [{ name: "The Cartographer" }] }, story("en")), []);
});

test("pronouns are never kept as another name", () => {
  const read = drafts.normalizeChapterExtraction({ characters: [{ name: "Mira", aliases: ["her", "Her", "the cartographer", "她"] }] }, "c1");
  assert.deepEqual(read.characters[0].aliases, ["the cartographer"]);
});
