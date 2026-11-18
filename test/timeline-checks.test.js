const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "timeline-checks-"));
process.env.DATA_FILE = path.join(dir, "db.json");
process.env.ENV_FILE = path.join(dir, ".env");
process.env.MOTAI_TEST_AI = "1";

const checks = require("../src/timeline-checks");
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

const chapters = [{ id: "c1", title: "The Map" }, { id: "c2", title: "The Archive" }, { id: "c3", title: "The Island" }];
const entities = [
  { id: "mira", type: "character", name: "Mira" },
  { id: "kael", type: "character", name: "Kael" },
  { id: "vell", type: "location", name: "Vell" },
  { id: "isle", type: "location", name: "The Island" }
];
const story = (canon, extra = {}) => ({ language: "en", title: "The Cartographer's Sister", chapters, canon: normalizeCanon({ entities, ...canon }), ...extra });
const kinds = (work) => checks.checkTimeline(work).map((problem) => [problem.kind, problem.eventIds]);

test("one person in two places at the same time is a problem; the same place, or another time, is not", () => {
  const event = (id, when, locationId, people = ["mira"]) => ({ id, title: id, storyOrder: 1, timeLabel: when, locationId, participantIds: people });
  const work = story({ events: [event("a", "Day 3", "vell"), event("b", " day 3 ", "isle"), event("c", "Day 3", "vell"), event("d", "Day 4", "isle"), event("e", "Day 3", "isle", ["kael"])] });
  const problems = checks.checkTimeline(work);
  assert.deepEqual(problems.map((problem) => problem.eventIds), [["a", "b"], ["b", "c"]]);
  assert.deepEqual(problems[0].params, { name: "Mira", when: "Day 3", event1: "a", place1: "Vell", event2: "b", place2: "The Island" });
});

test("someone taking part after a fact says they died is a problem, unless it happens before", () => {
  const events = [
    { id: "earlier", title: "Kael meets Mira", storyOrder: 1, chapterId: "c1", participantIds: ["kael"] },
    { id: "death", title: "The archive burns", storyOrder: 2, chapterId: "c2", participantIds: ["kael"] },
    { id: "after", title: "Kael returns", storyOrder: 3, chapterId: "c3", participantIds: ["kael", "mira"] }
  ];
  const fact = (value, extra = {}) => ({ id: "f1", category: "life_status", subjectId: "kael", predicate: "status", value, sourceChapterId: "c2", ...extra });
  const dead = story({ events, facts: [fact("died in the fire")] });
  assert.deepEqual(kinds(dead), [["afterDeath", ["after"]]]);
  assert.deepEqual(checks.checkTimeline(dead)[0].params, { name: "Kael", event: "Kael returns", chapter: 2, fact: "status died in the fire" });
  assert.deepEqual(kinds(story({ events, facts: [fact("not dead after all")] })), []);
  assert.deepEqual(kinds(story({ events, facts: [fact("在火中身亡")] })), [["afterDeath", ["after"]]]);
  assert.deepEqual(kinds(story({ events, facts: [fact("died", { status: "superseded" })] })), []);
  // Told later but happening before the death: a flashback, fine.
  const flashback = story({ events: [...events.slice(0, 2), { ...events[2], storyOrder: 0 }], facts: [fact("died")] });
  assert.deepEqual(kinds(flashback), []);
});

test("a setup paid off in an earlier chapter than it is planted is a problem", () => {
  const events = [{ id: "e1", title: "The map arrives", storyOrder: 1, chapterId: "c1" }];
  const work = story({
    events,
    setups: [
      { id: "s1", description: "The mark", plantedIn: { kind: "chapter", id: "c3" }, paidOffIn: { kind: "event", id: "e1" }, status: "paid" },
      { id: "s2", description: "The limp", plantedIn: { kind: "chapter", id: "c1" }, paidOffIn: { kind: "chapter", id: "c3" }, status: "open" },
      { id: "s3", description: "Dropped", plantedIn: { kind: "chapter", id: "c3" }, paidOffIn: { kind: "chapter", id: "c1" }, status: "dropped" }
    ]
  });
  const problems = checks.checkTimeline(work);
  assert.deepEqual(problems.map((problem) => [problem.kind, problem.setupId, problem.eventIds, problem.params]), [["payoffBeforePlant", "s1", ["e1"], { setup: "The mark", planted: 3, paid: 1 }]]);
});

test("asking what is missing reads the events in story order with short references, and maps the answer back to events", () => {
  const work = story({
    events: [
      { id: "late", title: "Mira lands on the island", storyOrder: 2, chapterId: "c3", participantIds: ["mira"], locationId: "isle" },
      { id: "early", title: "The map arrives", summary: "In her sister's hand", storyOrder: 1, chapterId: "c1", participantIds: ["mira"], timeLabel: "Day 1" }
    ],
    setups: [{ id: "s1", description: "The mark in the corner", plantedIn: { kind: "chapter", id: "c1" }, status: "open" }]
  }, { spine: { once: "Mira draws maps.", oneDay: "a map arrives." } });
  const request = checks.missingRequest(work);
  assert.ok(request.prompt.includes("E1. The map arrives — In her sister's hand (when: Day 1) [who: Mira] [told in chapter 1: The Map]\nE2. Mira lands on the island [who: Mira] [where: The Island] [told in chapter 3: The Island]"));
  assert.ok(request.prompt.includes("The story spine: Mira draws maps. a map arrives."));
  assert.ok(request.prompt.includes("- The mark in the corner"));
  assert.match(request.prompt, /do not invent facts about the story/);
  assert.deepEqual(checks.normalizeMissing({ gaps: [{ after: "e1", missing: " Between E1 and (E2), how does she cross the strait? E9 stays. " }, { after: "E9", missing: "Unplaced" }, { after: "E2", missing: "" }] }, work), [
    { afterEventId: "early", missing: "Between “The map arrives” and “Mira lands on the island”, how does she cross the strait? E9 stays." },
    { afterEventId: "", missing: "Unplaced" }
  ]);
  assert.throws(() => checks.missingRequest(story({ events: [{ id: "one", title: "Only one", storyOrder: 1 }] })), { code: "TIMELINE_TOO_SHORT" });
  assert.match(checks.missingRequest({ ...work, language: "zh-CN" }).prompt, /不要编造作品里没有的事实/);
});

test("HTTP: checks are read on demand, and asking what is missing saves nothing", async () => {
  const { body: { work } } = await call("/api/works", "POST", { title: "Checks", language: "en", focus: "shape" });
  const tooShort = await call(`/api/works/${work.id}/timeline/missing`, "POST", {});
  assert.equal(tooShort.status, 400);
  assert.equal(tooShort.body.error.code, "TIMELINE_TOO_SHORT");
  const mira = (await call(`/api/works/${work.id}/canon/entities`, "POST", { type: "character", name: "Mira" })).body.item;
  const vell = (await call(`/api/works/${work.id}/canon/entities`, "POST", { type: "location", name: "Vell" })).body.item;
  const isle = (await call(`/api/works/${work.id}/canon/entities`, "POST", { type: "location", name: "The Island" })).body.item;
  for (const [title, locationId] of [["In Vell", vell.id], ["On the island", isle.id]]) {
    await call(`/api/works/${work.id}/canon/events`, "POST", { title, timeLabel: "Day 3", locationId, participantIds: [mira.id] });
  }
  const read = await call(`/api/works/${work.id}/timeline/checks`);
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.problems.map((problem) => problem.kind), ["twoPlaces"]);
  const before = (await call(`/api/works/${work.id}/canon`)).body.canon.canonRevision;
  const missing = await call(`/api/works/${work.id}/timeline/missing`, "POST", {});
  assert.equal(missing.status, 200);
  assert.equal(missing.body.gaps.length, 1);
  assert.ok(missing.body.gaps[0].afterEventId);
  assert.equal((await call(`/api/works/${work.id}/canon`)).body.canon.canonRevision, before);
});
