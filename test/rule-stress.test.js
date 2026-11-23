const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rule-stress-"));
process.env.DATA_FILE = path.join(dir, "db.json");
process.env.ENV_FILE = path.join(dir, ".env");
process.env.MOTAI_TEST_AI = "1";

const stress = require("../src/rule-stress");
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
  title: "The Cartographer's Sister",
  premise: "A smuggler's mapmaker receives an unsigned map.",
  world: { what: "where the sea has swallowed the old roads", here: "a good map is worth more than gold" },
  canon: normalizeCanon({ entities: [
    { id: "names", type: "rule", name: "Speaking someone's true name gives power over them", card: { cost: "The speaker forgets a memory of their own" } },
    { id: "tide", type: "rule", name: "The tide never turns at night" },
    { id: "mira", type: "character", name: "Mira", summary: "A mapmaker" }
  ] })
});

test("the questions are asked about one rule, with its world, the other rules and the people", () => {
  const english = stress.questionsRequest(story("en"), "names");
  assert.ok(english.prompt.includes("Rule: Speaking someone's true name gives power over them\nCost or limit: The speaker forgets a memory of their own\nExceptions: (none yet)"));
  assert.ok(english.prompt.includes("The world: a world where the sea has swallowed the old roads, in which a good map is worth more than gold."));
  assert.ok(english.prompt.includes("- The tide never turns at night"));
  assert.ok(english.prompt.includes("Mira: A mapmaker"));
  assert.match(english.prompt, /If that is true, why can't/);
  assert.match(english.prompt, /do not ask about anything the rule, its cost or its exceptions already settle/);
  assert.match(stress.questionsRequest(story("zh-CN"), "names").prompt, /用简体中文/);
  assert.throws(() => stress.questionsRequest(story("en"), "mira"), { code: "CANON_ITEM_NOT_FOUND" });
  assert.deepEqual(stress.normalizeQuestions({ questions: [" Why not? ", "Why not?", "", "A", "B", "C"] }), ["Why not?", "A", "B"]);
  assert.throws(() => stress.normalizeQuestions({ questions: [] }), { code: "AI_ARTIFACT_EMPTY" });
});

test("folding uses only the author's answers, and never wipes what the card says", () => {
  const work = story("en");
  const answers = { answers: [{ question: "Why doesn't everyone hide their name?", answer: "Most people never learn their true name" }, { question: "Skipped?", answer: "  " }] };
  const request = stress.foldRequest(work, "names", answers);
  assert.ok(request.prompt.includes("Q1: Why doesn't everyone hide their name?\nAuthor: Most people never learn their true name"));
  assert.ok(!request.prompt.includes("Skipped?"));
  assert.match(request.prompt, /add no ideas of your own/);
  assert.throws(() => stress.foldRequest(work, "names", { answers: [{ question: "Q", answer: "" }] }), { code: "RULE_ANSWERS_REQUIRED" });
  // An empty field from the AI keeps the card's text.
  assert.deepEqual(stress.normalizeFold({ cost: "", exception: "Anyone who never learned their true name", detail: "" }, work, "names"), {
    cost: "The speaker forgets a memory of their own",
    exception: "Anyone who never learned their true name",
    detail: ""
  });
  assert.throws(() => stress.normalizeFold({ cost: "The speaker forgets a memory of their own" }, work, "names"), { code: "AI_ARTIFACT_EMPTY" });
  // One point written into two fields stays only in the first.
  const tide = { ...story("zh-CN"), canon: normalizeCanon({ entities: [{ id: "tide", type: "rule", name: "雾港的潮水夜里从不退去", card: { cost: "夜里船只无法出港" } }] }) };
  assert.deepEqual(stress.normalizeFold({ cost: "夜里船只无法出港", exception: "走私船会在黄昏前出港，在外海等到天亮", detail: "走私船趁黄昏前出港，到外海等候天亮再行动" }, tide, "tide"), {
    cost: "夜里船只无法出港", exception: "走私船会在黄昏前出港，在外海等到天亮", detail: ""
  });
  // Different points in different fields are all kept.
  const kept = stress.normalizeFold({
    cost: "The speaker forgets a memory of their own, and cannot choose which one: it is always the one they would least want to lose.",
    exception: "",
    detail: "Hired speakers are called hollows, and most end up remembering nothing at all."
  }, work, "names");
  assert.match(kept.cost, /cannot choose which one/);
  assert.match(kept.detail, /hollows/);
  // The prompt's own placeholder for an empty field is not text to keep.
  assert.equal(stress.normalizeFold({ cost: "Paid in memories", exception: "(none yet)", detail: "（暂无）" }, work, "names").exception, "");
});

test("HTTP: questions and a folded draft come back, and the rule is not changed until it is saved", async () => {
  const { body: { work } } = await call("/api/works", "POST", { title: "Rules", language: "en", focus: "shape" });
  const rule = (await call(`/api/works/${work.id}/canon/entities`, "POST", { type: "rule", name: "The tide never turns at night" })).body.item;
  const asked = await call(`/api/works/${work.id}/canon/drafts/rule-questions`, "POST", { ruleId: rule.id });
  assert.equal(asked.status, 200);
  assert.equal(asked.body.questions.length, 3);
  const folded = await call(`/api/works/${work.id}/canon/drafts/rule-answers`, "POST", { ruleId: rule.id, answers: [{ question: asked.body.questions[0], answer: "Only the harbour priests know why" }] });
  assert.equal(folded.status, 200);
  assert.match(folded.body.draft.exception, /Only the harbour priests know why/);
  const saved = (await call(`/api/works/${work.id}/canon`)).body.canon.entities.find((entity) => entity.id === rule.id);
  assert.equal(saved.revision, rule.revision);
  assert.equal(saved.card.exception, undefined);
  assert.equal((await call(`/api/works/${work.id}/canon/drafts/rule-questions`, "POST", { ruleId: "nope" })).status, 404);
});
