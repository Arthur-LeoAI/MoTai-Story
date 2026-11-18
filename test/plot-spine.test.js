const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plot-spine-"));
process.env.DATA_FILE = path.join(dir, "db.json");
process.env.ENV_FILE = path.join(dir, ".env");
process.env.MOTAI_TEST_AI = "1";

const spine = require("../src/plot-spine");
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

const story = (language, lines = {}) => ({
  language,
  title: language === "en" ? "The Cartographer's Sister" : "雾港来信",
  premise: "A mapmaker receives an unsigned map.",
  spine: { ...lines, revision: 1 },
  canon: normalizeCanon({
    entities: [{ id: "mira", type: "character", name: "Mira", summary: "A mapmaker on the run" }],
    events: [{ id: "e2", title: "The archive burns", storyOrder: 2 }, { id: "e1", title: "The map arrives", summary: "Unsigned, in her sister's hand", storyOrder: 1 }]
  })
});

test("a missing spine reads as six empty sentences, with one box for 'because of that'", () => {
  assert.deepEqual(spine.normalizeSpine(undefined), { once: "", everyDay: "", oneDay: "", because: [""], finally: "", everSince: "", revision: 0, updatedAt: "" });
  const kept = spine.normalizeSpine({ once: "  Mira   draws maps ", because: ["a", "", "b"], extra: "dropped" });
  assert.equal(kept.once, "Mira draws maps");
  assert.deepEqual(kept.because, ["a", "", "b"]);
  assert.equal("extra" in kept, false);
});

test("saving needs the revision it was read at, and changes only the sentences sent", () => {
  const work = { spine: { once: "Mira draws maps", revision: 2 } };
  assert.throws(() => spine.updateSpine(work, { lines: { everyDay: "x" }, baseRevision: 1 }, "t"), { code: "REVISION_CONFLICT" });
  assert.throws(() => spine.updateSpine(work, { lines: { because: "not a list" }, baseRevision: 2 }, "t"), { code: "BAD_REQUEST" });
  const saved = spine.updateSpine(work, { lines: { everyDay: "She keeps to the harbour", because: ["The map leads north"] }, baseRevision: 2 }, "2026-11-17T00:00:00.000Z");
  assert.equal(saved.once, "Mira draws maps");
  assert.equal(saved.everyDay, "She keeps to the harbour");
  assert.deepEqual(saved.because, ["The map leads north"]);
  assert.equal(saved.revision, 3);
  assert.equal(work.spine, saved);
});

test("a suggestion request carries the story, the cast, the events in order, the spine so far, and the asked line", () => {
  const english = spine.suggestionRequest(story("en", { once: "Mira draws maps for smugglers", oneDay: "an unsigned map arrives" }), { line: "everyDay" });
  assert.match(english.prompt, /finish the sentence "Every day…"/);
  assert.ok(english.prompt.includes("Mira: A mapmaker on the run"));
  assert.ok(english.prompt.includes("1. The map arrives — Unsigned, in her sister's hand\n2. The archive burns"));
  assert.ok(english.prompt.includes("Once upon a time… Mira draws maps for smugglers\nEvery day… (empty) ← suggest this one\nUntil one day… an unsigned map arrives"));
  assert.match(english.prompt, /do not add new main characters/);
  assert.match(english.prompt, /Write in English/);
  // A new "because of that" sentence is marked after the last one.
  const next = spine.suggestionRequest(story("en", { because: ["she sails north"] }), { line: "because", index: 1 });
  assert.ok(next.prompt.includes("Because of that… she sails north\nBecause of that… (empty) ← suggest this one"));
  const chinese = spine.suggestionRequest(story("zh-CN"), { line: "finally" });
  assert.match(chinese.prompt, /"直到最后……"这一句/);
  assert.match(chinese.prompt, /用简体中文/);
  assert.throws(() => spine.suggestionRequest(story("en"), { line: "middle" }), { code: "BAD_REQUEST" });
  assert.throws(() => spine.suggestionRequest(story("en"), { line: "because", index: 99 }), { code: "BAD_REQUEST" });
});

test("suggestions drop repeated opening words, duplicates and empties, and keep three at most", () => {
  assert.deepEqual(spine.normalizeSuggestions({ suggestions: ["Until one day, a map arrives.", "a map arrives.", "  ", "The harbour floods.", "Kael returns.", "A fourth one."] }, "oneDay"), ["a map arrives.", "The harbour floods.", "Kael returns."]);
  assert.deepEqual(spine.normalizeSuggestions({ suggestions: ["直到有一天，一张地图寄到了。"] }, "oneDay"), ["一张地图寄到了。"]);
  assert.throws(() => spine.normalizeSuggestions({ suggestions: [] }, "once"), { code: "AI_ARTIFACT_EMPTY" });
});

test("HTTP: the spine is saved on the story, conflicts are refused, and suggestions save nothing", async () => {
  const { body: { work } } = await call("/api/works", "POST", { title: "Spine", language: "en", focus: "shape" });
  const read = await call(`/api/works/${work.id}/spine`);
  assert.equal(read.status, 200);
  assert.equal(read.body.spine.revision, 0);

  const saved = await call(`/api/works/${work.id}/spine`, "PUT", { lines: { once: "Mira draws maps" }, baseRevision: 0 });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.spine.revision, 1);
  const stale = await call(`/api/works/${work.id}/spine`, "PUT", { lines: { once: "Someone else" }, baseRevision: 0 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, "REVISION_CONFLICT");

  const suggested = await call(`/api/works/${work.id}/spine/suggestions`, "POST", { line: "oneDay" });
  assert.equal(suggested.status, 200);
  assert.equal(suggested.body.suggestions.length, 3);
  const after = await call(`/api/works/${work.id}/spine`);
  assert.equal(after.body.spine.once, "Mira draws maps");
  assert.equal(after.body.spine.oneDay, "");
  assert.equal(after.body.spine.revision, 1);
  assert.equal((await call(`/api/works/${work.id}/spine/suggestions`, "POST", { line: "nope" })).status, 400);
});
