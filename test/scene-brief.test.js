const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scene-brief-"));
process.env.DATA_FILE = path.join(dir, "db.json");
process.env.ENV_FILE = path.join(dir, ".env");
process.env.MOTAI_TEST_AI = "1";

const { buildSceneBrief, normalizeExcluded } = require("../src/scene-brief");
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
  return { status: response.status, body: await response.json() };
}

function story() {
  return {
    language: "en",
    chapters: [
      { id: "c1", content: "Mira waited at Low Ford. The ferryman did not look up.", planning: { goal: "Get Mira across the river" }, scenes: [{ participants: "Mira, Kael", location: "the ferry" }], briefExcluded: ["derived:entity:kael", "derived:entity:voss", "not an id!"] },
      { id: "c2", content: "" }
    ],
    canon: normalizeCanon({
      entities: [
        { id: "mira", type: "character", name: "Mira", summary: "A mapmaker" },
        { id: "kael", type: "character", name: "Kael", summary: "A warden" },
        { id: "voss", type: "character", name: "Voss", summary: "Governor" },
        { id: "tam", type: "character", name: "Old Tam" },
        { id: "miranda", type: "character", name: "Mir", summary: "Only a prefix of Mira" },
        { id: "ford", type: "location", name: "Low Ford", summary: "A crossing" },
        { id: "rule", type: "rule", name: "Self-drawn maps", summary: "A map drawn for oneself misleads its maker" }
      ],
      relations: [{ id: "r1", fromId: "kael", toId: "mira", kind: "friend" }, { id: "r2", fromId: "voss", toId: "mira", kind: "enemy" }],
      events: [{ id: "e1", title: "Kael lets her go", chapterId: "c1", participantIds: ["kael", "tam"] }, { id: "e2", title: "Later", chapterId: "c2" }],
      setups: [
        { id: "s1", description: "The mark on the map", plantedIn: { kind: "chapter", id: "c1" } },
        { id: "s2", description: "Planted later", plantedIn: { kind: "chapter", id: "c2" } },
        { id: "s3", description: "Already paid", plantedIn: { kind: "chapter", id: "c1" }, status: "paid" }
      ]
    })
  };
}

const items = (brief, key) => brief.sections.find((section) => section.key === key).items;

test("the brief gathers who and what this chapter touches, from its plan, scenes and text", () => {
  const brief = buildSceneBrief(story(), "c1");
  assert.deepEqual(brief.goal, { text: "Get Mira across the river", source: "planning" });
  // Whole names only: "Mir" is not found inside "Mira".
  assert.deepEqual(items(brief, "people").map((item) => [item.label, item.reason]), [["Mira", "named"], ["Kael", "named"], ["Old Tam", "event"]]);
  assert.deepEqual(items(brief, "places").map((item) => item.label), ["Low Ford"]);
  // Only relationships between people who are here.
  assert.deepEqual(items(brief, "relations").map((item) => item.factId), ["derived:relation:r1"]);
  assert.deepEqual(items(brief, "threads").map((item) => [item.label, item.reason]), [["Kael lets her go", "happens"], ["The mark on the map", "open"]]);
  assert.equal(buildSceneBrief(story(), "missing"), null);
});

test("cards and open threads can be left out; rules, relationships and events always stay", () => {
  const brief = buildSceneBrief(story(), "c1");
  const excludable = (key) => items(brief, key).map((item) => item.excludable);
  assert.deepEqual(excludable("people"), [true, true, false], "a card with nothing on it has no fact to leave out");
  assert.deepEqual(excludable("rules"), [false]);
  assert.deepEqual(excludable("relations"), [false]);
  assert.deepEqual(excludable("threads"), [false, true]);
  // Cards not named here are still given to the assistant, so the brief lists them too.
  assert.deepEqual(items(brief, "others").map((item) => [item.label, item.excludable]), [["Voss", true], ["Mir", true]]);
  // Only what is in this brief counts as left out.
  assert.deepEqual(brief.excluded, ["derived:entity:kael", "derived:entity:voss"]);
  assert.deepEqual(normalizeExcluded(["a:b", "a:b", "bad id", 7, "x".repeat(200)]), ["a:b"]);
});

test("a goal comes from the scenes when the plan has none", () => {
  const work = story();
  work.chapters[0].planning = {};
  work.chapters[0].scenes = [{ goal: "Reach the ferry" }, { goal: "Lose Kael" }];
  assert.deepEqual(buildSceneBrief(work, "c1").goal, { text: "Reach the ferry\nLose Kael", source: "scenes" });
});

test("HTTP: what the writer unticks in the brief is left out of what the assistant is given", async () => {
  const { body: { work } } = await call("/api/works", "POST", { title: "Brief", language: "en" });
  const chapter = work.chapters[0];
  const root = `/api/works/${work.id}`;
  const card = async (data) => (await call(`${root}/canon/entities`, "POST", data)).body.item;
  const mira = await card({ type: "character", name: "Mira", summary: "A mapmaker" });
  const kael = await card({ type: "character", name: "Kael", summary: "A warden" });
  const rule = await card({ type: "rule", name: "Maps", summary: "A self-drawn map misleads its maker" });
  const saved = await call(`${root}/chapters/${chapter.id}`, "PATCH", { baseRevision: chapter.revision, content: "Mira and Kael met at the ferry." });

  const brief = (await call(`${root}/chapters/${chapter.id}/brief`)).body.brief;
  assert.deepEqual(brief.sections.find((section) => section.key === "people").items.map((item) => item.label), ["Mira", "Kael"]);
  assert.deepEqual(brief.excluded, []);

  // Untick Kael, and try to untick the rule too.
  const kaelFact = `derived:entity:${kael.id}`;
  const ruleFact = `derived:entity:${rule.id}`;
  const unticked = await call(`${root}/chapters/${chapter.id}`, "PATCH", { baseRevision: saved.body.chapter.revision, briefExcluded: [kaelFact, ruleFact] });
  assert.equal(unticked.status, 200);
  assert.equal(unticked.body.chapter.revision, saved.body.chapter.revision, "unticking does not count as an edit of the text");

  const started = await call("/api/tasks", "POST", { requestId: `brief-${work.id}`, workId: work.id, chapterId: chapter.id, baseRevision: saved.body.chapter.revision, mode: "continue", instruction: "", range: { index: 0, length: 0 } });
  let task = started.body.task;
  while (!["completed", "failed"].includes(task.status)) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    task = (await call(`/api/tasks/${task.id}`)).body.task;
  }
  assert.equal(task.status, "completed", task.message);
  const used = task.result.generation.context.canonFactIds;
  assert.ok(used.includes(`derived:entity:${mira.id}`));
  assert.ok(!used.includes(kaelFact), "the unticked card is left out");
  assert.ok(used.includes(ruleFact), "a rule stays even if asked to leave it out");
});
