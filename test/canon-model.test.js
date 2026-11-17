const test = require("node:test");
const assert = require("node:assert/strict");

const { DATABASE_SCHEMA_VERSION, normalizeCanon, upgradeDatabase } = require("../src/continuity");
const { selectTemporalFacts } = require("../src/temporal");
const {
  chapterDerivedFactIds, continuityFacts, dependentDerivedFactIds, deriveCanonFacts, describeCanon,
  isDerivedFactId, normalizeEntity
} = require("../src/canon-model");

const at = "2026-11-13T00:00:00.000Z";
const ids = (values) => values.map((item) => item.id);

function story(overrides = {}) {
  return {
    id: "work_1",
    language: "en",
    chapters: [{ id: "c1" }, { id: "c2" }, { id: "c3" }],
    canon: normalizeCanon({
      entities: [
        { id: "mira", type: "character", name: "Mira", aliases: ["the cartographer"], summary: "A mapmaker on the run", card: { want: "To find her sister", secret: "She forged the map" }, notes: "private working notes" },
        { id: "kael", type: "character", name: "Kael" },
        { id: "harbour", type: "location", name: "Fog Harbour", summary: "A port that never clears" },
        { id: "naming", type: "rule", name: "True names", summary: "Saying a true name commands its owner", card: { cost: "The speaker loses a memory" } }
      ],
      relations: [
        { id: "r1", fromId: "kael", toId: "mira", kind: "friend", tension: "He owes her his life", storyFrom: 0, storyUntil: 10 },
        { id: "r2", fromId: "kael", toId: "mira", kind: "custom", label: "hunter and quarry", storyFrom: 10 }
      ],
      threads: [{ id: "t1", name: "Finding the sister", color: "rubric" }],
      events: [
        { id: "e1", title: "The unsigned map arrives", summary: "Mira receives a map", storyOrder: 2, timeLabel: "Day one", chapterId: "c2", participantIds: ["mira"], locationId: "harbour", threadIds: ["t1"] },
        { id: "e2", title: "The sister vanishes", storyOrder: 1, timeLabel: "Three years earlier" }
      ],
      setups: [
        { id: "s1", description: "A mark in the corner of the map", plantedIn: { kind: "event", id: "e1" } },
        { id: "s2", description: "The harbour bell", plantedIn: { kind: "chapter", id: "c1" }, status: "paid" },
        { id: "s3", description: "A cut thread", plantedIn: { kind: "chapter", id: "c1" }, status: "dropped" }
      ],
      facts: [{ id: "fact_1", predicate: "Mira's trade", value: "cartographer", effectiveOrder: 0 }]
    }),
    ...overrides
  };
}

test("v5 data upgrades to v6 by gaining defaults; story material text is kept as it is", () => {
  let sequence = 0;
  const legacy = {
    schemaVersion: 5,
    works: [{
      id: "work_1",
      storyBible: { characters: "林舟：维修学徒", relationships: "林舟与梅是旧友" },
      chapters: [{ id: "chapter_1", title: "第一章", content: "开场" }],
      canon: {
        status: "draft",
        entities: [{ id: "entity_lin", type: "character", name: "林舟", aliases: ["小舟"], createdAt: at, updatedAt: at }],
        facts: [{ id: "fact_1", category: "relationship", predicate: "旧友", value: "梅", createdAt: at, updatedAt: at }]
      }
    }]
  };
  const first = upgradeDatabase(legacy, { idFactory: (prefix) => `${prefix}_${++sequence}`, now: at });
  const work = first.db.works[0];

  assert.equal(first.changed, true);
  assert.equal(first.db.schemaVersion, 6);
  assert.equal(DATABASE_SCHEMA_VERSION, 6);
  assert.deepEqual(work.storyBible, { characters: "林舟：维修学徒", relationships: "林舟与梅是旧友" });
  assert.deepEqual(work.canon.entities[0], {
    id: "entity_lin", ownerId: "local", type: "character", name: "林舟", aliases: ["小舟"],
    summary: "", card: {}, notes: "", image: "", color: "", revision: 1, createdAt: at, updatedAt: at
  });
  for (const collection of ["relations", "events", "threads", "setups"]) assert.deepEqual(work.canon[collection], []);
  // The old relationship fact stays a fact; nothing is converted or dropped.
  assert.equal(work.canon.facts.length, 1);
  assert.equal(work.canon.facts[0].category, "relationship");
  assert.equal(work.canon.status, "draft");

  const second = upgradeDatabase(first.db, { idFactory: () => { throw new Error("no new ids on upgraded data"); }, now: "2030-01-01T00:00:00.000Z" });
  assert.equal(second.changed, false);
  assert.deepEqual(second.db, first.db);
});

test("upgrade gives new objects ids and removes references to things that do not exist", () => {
  let sequence = 0;
  const { db } = upgradeDatabase({
    works: [{
      id: "work_1",
      chapters: [{ id: "c1", title: "One", content: "" }],
      canon: {
        entities: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { name: "" }],
        relations: [{ fromId: "a", toId: "b", kind: "ally" }, { fromId: "a", toId: "gone" }, { fromId: "a", toId: "a" }],
        threads: [{ id: "t", name: "Main" }],
        events: [{ title: "Meeting", participantIds: ["a", "gone"], locationId: "gone", threadIds: ["t", "gone"] }, { title: "" }],
        setups: [{ description: "A sign", plantedIn: { kind: "event", id: "gone" }, paidOffIn: { kind: "chapter", id: "c9" } }]
      }
    }]
  }, { idFactory: (prefix) => `${prefix}_${++sequence}`, now: at });
  const canon = db.works[0].canon;

  assert.deepEqual(ids(canon.entities), ["a", "b"]);
  assert.equal(canon.relations.length, 1);
  assert.match(canon.relations[0].id, /^relation_/);
  assert.equal(canon.events.length, 1);
  assert.match(canon.events[0].id, /^event_/);
  assert.deepEqual(canon.events[0].participantIds, ["a"]);
  assert.equal(canon.events[0].locationId, "");
  assert.deepEqual(canon.events[0].threadIds, ["t"]);
  assert.match(canon.setups[0].id, /^setup_/);
  assert.equal(canon.setups[0].plantedIn, null);
  // A chapter reference survives: the chapter may be in the trash and come back.
  assert.deepEqual(canon.setups[0].paidOffIn, { kind: "chapter", id: "c9" });
});

test("cards keep only the questions of their type; colours are palette keys, never values", () => {
  const character = normalizeEntity({ name: " Mira ", type: "character", card: { want: " a home ", cost: "not a character field", secret: "" }, color: "#ff0000" });
  assert.equal(character.name, "Mira");
  assert.deepEqual(character.card, { want: "a home" });
  assert.equal(character.color, "");
  assert.equal(normalizeEntity({ name: "x", color: "rubric" }).color, "rubric");
  assert.deepEqual(normalizeEntity({ name: "Rule", type: "rule", card: { cost: "a memory", want: "no" } }).card, { cost: "a memory" });
  assert.equal(normalizeEntity({ name: "x", type: "spaceship" }).type, "character");
});

test("each structured object stands for one derived fact, recomputed and never stored", () => {
  const work = story();
  const facts = deriveCanonFacts(work);
  const byId = Object.fromEntries(facts.map((fact) => [fact.id, fact]));

  assert.ok(facts.every((fact) => isDerivedFactId(fact.id)));
  assert.deepEqual(Object.keys(byId).sort(), [
    "derived:entity:harbour", "derived:entity:mira", "derived:entity:naming",
    "derived:event:e1", "derived:relation:r1", "derived:relation:r2",
    "derived:setup:s1", "derived:setup:s2"
  ]);
  // A bare name says nothing to check against.
  assert.equal(byId["derived:entity:kael"], undefined);

  const mira = byId["derived:entity:mira"];
  assert.equal(mira.category, "identity");
  assert.equal(mira.strength, "soft");
  assert.equal(mira.subjectId, "mira");
  assert.equal(mira.predicate, "Mira (also called the cartographer)");
  assert.equal(mira.value, "A mapmaker on the run; Wants: To find her sister; Secret: She forged the map");
  assert.doesNotMatch(mira.value, /private working notes/);

  const rule = byId["derived:entity:naming"];
  assert.equal(rule.category, "world_rule");
  assert.equal(rule.strength, "hard");
  assert.match(rule.value, /Cost or limit: The speaker loses a memory/);

  const relation = byId["derived:relation:r1"];
  assert.deepEqual([relation.category, relation.subjectId, relation.objectId, relation.storyFrom, relation.storyUntil], ["relationship", "kael", "mira", 0, 10]);
  assert.equal(relation.predicate, "Kael → Mira");
  assert.equal(relation.value, "friends; Tension: He owes her his life");
  assert.equal(byId["derived:relation:r2"].value, "hunter and quarry");

  const event = byId["derived:event:e1"];
  assert.deepEqual([event.category, event.readerOrder, event.sourceChapterId], ["timeline", 1, "c2"]);
  assert.equal(event.value, "Mira receives a map; When: Day one; Who: Mira; Where: Fog Harbour");
  // No chapter tells e2 yet: it is the author's plan, not something to write from.
  assert.equal(byId["derived:event:e2"], undefined);

  assert.deepEqual([byId["derived:setup:s1"].readerOrder, byId["derived:setup:s1"].status], [1, "active"]);
  assert.deepEqual([byId["derived:setup:s2"].readerOrder, byId["derived:setup:s2"].status], [0, "resolved"]);
  assert.equal(byId["derived:setup:s3"], undefined);

  assert.equal(work.canon.facts.length, 1, "derivation must not write into stored facts");
  assert.deepEqual(ids(continuityFacts(work)).slice(0, 1), ["fact_1"]);
  assert.equal(continuityFacts(work).length, 1 + facts.length);
});

test("derived wording follows the story language", () => {
  const facts = deriveCanonFacts(story({ language: "zh-CN" }));
  const mira = facts.find((fact) => fact.id === "derived:entity:mira");
  assert.equal(mira.value, "A mapmaker on the run；想要：To find her sister；秘密：She forged the map");
  assert.equal(facts.find((fact) => fact.id === "derived:relation:r1").value, "朋友；张力：He owes her his life");
  assert.equal(facts.find((fact) => fact.id === "derived:setup:s1").predicate, "伏笔");
});

test("derived facts obey story time and reader order like any other fact", () => {
  const facts = continuityFacts(story());
  const select = (options) => ids(selectTemporalFacts(facts, options));

  // Chapter 1 (reader order 0): the event told in chapter 2 and its setup are not known yet.
  const early = select({ storyTime: 5, readerOrder: 0 });
  assert.ok(early.includes("derived:relation:r1"));
  assert.ok(!early.includes("derived:relation:r2"));
  assert.ok(!early.includes("derived:event:e1"));
  assert.ok(!early.includes("derived:setup:s1"));
  assert.ok(early.includes("derived:setup:s2"));

  // Later in story time the relationship has changed; the interval is half-open.
  const late = select({ storyTime: 10, readerOrder: 2 });
  assert.ok(!late.includes("derived:relation:r1"));
  assert.ok(late.includes("derived:relation:r2"));
  assert.ok(late.includes("derived:event:e1"));
  assert.ok(late.includes("derived:setup:s1"));

  // Without a place in story time nothing derived may block as a hard fact.
  const unplaced = selectTemporalFacts(facts, { readerOrder: 2 }).filter((fact) => isDerivedFactId(fact.id));
  assert.ok(unplaced.length > 0);
  assert.ok(unplaced.every((fact) => fact.strength === "soft"));
});

test("dependents: a renamed entity reaches the facts that spell its name, and nothing else", () => {
  const { canon } = story();
  assert.deepEqual(dependentDerivedFactIds(canon, "entities", "mira").sort(), ["derived:entity:mira", "derived:event:e1", "derived:relation:r1", "derived:relation:r2"]);
  assert.deepEqual(dependentDerivedFactIds(canon, "entities", "harbour").sort(), ["derived:entity:harbour", "derived:event:e1"]);
  assert.deepEqual(dependentDerivedFactIds(canon, "entities", "naming"), ["derived:entity:naming"]);
  assert.deepEqual(dependentDerivedFactIds(canon, "relations", "r1"), ["derived:relation:r1"]);
  assert.deepEqual(dependentDerivedFactIds(canon, "events", "e1").sort(), ["derived:event:e1", "derived:setup:s1"]);
  assert.deepEqual(dependentDerivedFactIds(canon, "threads", "t1"), []);
  assert.deepEqual(chapterDerivedFactIds(canon, ["c2"]).sort(), ["derived:event:e1", "derived:setup:s1"]);
  assert.deepEqual(chapterDerivedFactIds(canon, ["c1"]).sort(), ["derived:setup:s2", "derived:setup:s3"]);
  assert.deepEqual(chapterDerivedFactIds(canon, ["c3"]), []);
});

test("describeCanon lists cards and relationships for a prompt, without private notes", () => {
  const text = describeCanon(story());
  assert.match(text, /^Characters:\n- Mira \(also called the cartographer\): A mapmaker on the run; Wants: To find her sister/);
  assert.match(text, /\n- Kael\n/);
  assert.match(text, /Rules of the world:\n- True names: Saying a true name commands its owner; Cost or limit: The speaker loses a memory/);
  assert.match(text, /Relationships:\n- Kael → Mira: friends; Tension: He owes her his life/);
  assert.doesNotMatch(text, /private working notes/);
  assert.equal(describeCanon({ canon: normalizeCanon() }), "");
  assert.ok(describeCanon(story(), { limit: 80 }).length <= 80);
  assert.match(describeCanon(story({ language: "zh-CN" })), /^人物：\n- Mira \(又称 the cartographer\)：/);
});
