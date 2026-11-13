const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "canon-api-"));
process.env.DATA_FILE = path.join(dir, "db.json");
process.env.ENV_FILE = path.join(dir, ".env");
process.env.MOTAI_TEST_AI = "1";

const { createAppServer, buildChatSystemPrompt } = require("../server");
const { createJsonStore } = require("../src/storage");
const { createCanonRepository, REASON_CHANGED, REASON_REMOVED } = require("../src/canon-store");
const { LOCAL_USER } = require("../src/auth");

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
  const response = await fetch(base + url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) })
  });
  return { status: response.status, body: await response.json() };
}

async function finished(taskId) {
  for (;;) {
    const { body } = await call(`/api/tasks/${taskId}`);
    if (["completed", "failed", "cancelled", "interrupted"].includes(body.task.status)) return body.task;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// A repository on its own temporary database, with predictable ids.
async function fixture(name) {
  const store = createJsonStore(path.join(dir, `${name}.json`));
  let sequence = 0;
  const repository = createCanonRepository(store, { makeId: (prefix) => `${prefix}_${++sequence}`, now: () => "2026-11-13T00:00:00.000Z" });
  await store.write({
    schemaVersion: 6,
    works: [{
      id: "w1", ownerId: "local", language: "en", title: "Test",
      chapters: [{ id: "c1", title: "One", content: "" }, { id: "c2", title: "Two", content: "" }],
      canon: { entities: [], facts: [] }, generationRecords: [], canonProposals: []
    }]
  });
  const work = async () => (await store.read()).works[0];
  return { store, repository, work };
}

const code = (expected) => (error) => error.code === expected;

test("HTTP: create, read, change and remove structured story objects", async () => {
  const { body: { work } } = await call("/api/works", "POST", { title: "Canon", language: "en" });
  const root = `/api/works/${work.id}/canon`;

  const empty = await call(root);
  assert.equal(empty.status, 200);
  assert.deepEqual([empty.body.canon.entities, empty.body.canon.relations, empty.body.canon.events, empty.body.canon.threads, empty.body.canon.setups], [[], [], [], [], []]);
  const startRevision = empty.body.canon.canonRevision;

  const mira = await call(`${root}/entities`, "POST", { type: "character", name: "Mira", summary: "A mapmaker on the run", card: { want: "To find her sister", cost: "ignored: not a character field" } });
  assert.equal(mira.status, 201);
  assert.equal(mira.body.item.ownerId, LOCAL_USER.id);
  assert.equal(mira.body.item.revision, 1);
  assert.deepEqual(mira.body.item.card, { want: "To find her sister" });
  assert.equal(mira.body.canonRevision, startRevision + 1);
  const kael = (await call(`${root}/entities`, "POST", { type: "character", name: "Kael" })).body.item;

  const relation = await call(`${root}/relations`, "POST", { fromId: kael.id, toId: mira.body.item.id, kind: "friend", tension: "He owes her his life", storyFrom: 0, storyUntil: 10 });
  assert.equal(relation.status, 201);

  const changed = await call(`${root}/entities/${mira.body.item.id}`, "PATCH", { baseRevision: 1, card: { secret: "She forged the map" }, aliases: ["the cartographer"] });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.item.revision, 2);
  assert.deepEqual(changed.body.item.card, { want: "To find her sister", secret: "She forged the map" });

  const stale = await call(`${root}/entities/${mira.body.item.id}`, "PATCH", { baseRevision: 1, name: "Overwritten" });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, "REVISION_CONFLICT");
  assert.equal((await call(`${root}/entities/${mira.body.item.id}`, "PATCH", { name: "No revision" })).status, 428);

  // The whole story as other pages read it carries the same objects.
  const loaded = (await call(`/api/works/${work.id}`)).body.work;
  assert.equal(loaded.canon.entities.length, 2);
  assert.equal(loaded.canon.relations[0].kind, "friend");
  assert.equal(loaded.canonRevision, (await call(root)).body.canon.canonRevision);

  // The conversation in Ideate is told about the cards.
  assert.match(buildChatSystemPrompt(loaded), /Characters:\n- Mira \(also called the cartographer\): A mapmaker on the run; Wants: To find her sister/);
  assert.match(buildChatSystemPrompt(loaded), /Relationships:\n- Kael → Mira: friends/);

  const removed = await call(`${root}/entities/${kael.id}`, "DELETE", { baseRevision: 1 });
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body.removed, { id: kael.id, relationIds: [relation.body.item.id] });
  const after = (await call(root)).body.canon;
  assert.deepEqual(after.entities.map((entity) => entity.name), ["Mira"]);
  assert.deepEqual(after.relations, []);

  const unknownCollection = await call(`${root}/spaceships`, "POST", { name: "x" });
  assert.equal(unknownCollection.status, 404);
  assert.equal(unknownCollection.body.error.code, "ROUTE_NOT_FOUND");
  assert.equal((await call("/api/works/missing/canon")).body.error.code, "WORK_NOT_FOUND");
  assert.equal((await call(`${root}/entities/missing`, "PATCH", { baseRevision: 1, name: "x" })).body.error.code, "CANON_ITEM_NOT_FOUND");
});

test("HTTP: a card enters the writing context, and changing canon still blocks text generated before the change", async () => {
  const { body: { work } } = await call("/api/works", "POST", { title: "Guard", language: "en" });
  const chapter = work.chapters[0];
  const root = `/api/works/${work.id}/canon`;
  const rule = (await call(`${root}/entities`, "POST", { type: "rule", name: "True names", summary: "Saying a true name commands its owner" })).body.item;

  const started = await call("/api/tasks", "POST", { requestId: "canon-guard", workId: work.id, chapterId: chapter.id, baseRevision: chapter.revision, mode: "continue", range: { index: 0, length: 0 } });
  const task = await finished(started.body.task.id);
  assert.equal(task.status, "completed", task.message);
  const record = task.result.generation;
  assert.ok(record.context.canonFactIds.includes(`derived:entity:${rule.id}`));
  assert.deepEqual(record.context.factVersions.find((entry) => entry.id === `derived:entity:${rule.id}`), { id: `derived:entity:${rule.id}`, revision: 1 });

  // The writer changes the rule while the suggestion is waiting.
  const changed = await call(`${root}/entities/${rule.id}`, "PATCH", { baseRevision: 1, card: { cost: "The speaker loses a memory" } });
  assert.deepEqual(changed.body.impacts.generationRecordIds, [record.id]);

  const merge = await call(`/api/works/${work.id}/chapters/${chapter.id}/generations/${record.id}/merge`, "POST", { baseRevision: chapter.revision, hunkIds: [record.hunks[0].id] });
  assert.equal(merge.status, 409);
  assert.equal(merge.body.error.code, "GENERATION_STALE");
});

test("validation: every refusal is a named error and leaves the story untouched", async () => {
  const { repository, work } = await fixture("validation");
  const user = LOCAL_USER;
  const before = JSON.stringify((await work()).canon);

  await assert.rejects(repository.create("w1", user, "entities", { type: "event", name: "Old kind" }), code("CANON_ENTITY_TYPE_UNSUPPORTED"));
  await assert.rejects(repository.create("w1", user, "entities", { name: "No type" }), code("CANON_ENTITY_TYPE_UNSUPPORTED"));
  await assert.rejects(repository.create("w1", user, "entities", { type: "character", name: "   " }), code("CANON_NAME_REQUIRED"));
  await assert.rejects(repository.create("w1", user, "entities", { type: "character", name: 7 }), code("BAD_REQUEST"));
  await assert.rejects(repository.create("w1", user, "entities", { type: "character", name: "A", card: "text" }), code("BAD_REQUEST"));
  await assert.rejects(repository.create("w1", user, "threads", {}), code("CANON_NAME_REQUIRED"));
  await assert.rejects(repository.create("w1", user, "events", { title: "" }), code("CANON_NAME_REQUIRED"));
  await assert.rejects(repository.create("w1", user, "setups", { status: "open" }), code("CANON_NAME_REQUIRED"));
  await assert.rejects(repository.create("w1", user, "setups", { description: "x", status: "lost" }), code("BAD_REQUEST"));
  await assert.rejects(repository.create("w1", user, "entities", []), code("BAD_REQUEST"));
  await assert.rejects(repository.create("w1", user, "planets", { name: "x" }), code("ROUTE_NOT_FOUND"));
  await assert.rejects(repository.create("missing", user, "threads", { name: "x" }), code("WORK_NOT_FOUND"));
  assert.equal(JSON.stringify((await work()).canon), before);

  const a = (await repository.create("w1", user, "entities", { type: "character", name: "A" })).item;
  const b = (await repository.create("w1", user, "entities", { type: "faction", name: "B" })).item;
  const place = (await repository.create("w1", user, "entities", { type: "location", name: "Harbour" })).item;
  const thread = (await repository.create("w1", user, "threads", { name: "Main", color: "rubric" })).item;

  await assert.rejects(repository.create("w1", user, "relations", { fromId: a.id, toId: "gone" }), (error) => error.code === "CANON_REFERENCE_NOT_FOUND" && error.params.field === "toId");
  await assert.rejects(repository.create("w1", user, "relations", { fromId: a.id, toId: a.id }), code("CANON_RELATION_SELF"));
  await assert.rejects(repository.create("w1", user, "relations", { fromId: a.id, toId: b.id, kind: "nemesis" }), code("BAD_REQUEST"));
  await assert.rejects(repository.create("w1", user, "relations", { fromId: a.id, toId: b.id, storyFrom: 5, storyUntil: 5 }), code("CANON_STORY_RANGE_INVALID"));
  await assert.rejects(repository.create("w1", user, "relations", { fromId: a.id, toId: b.id, storyFrom: "soon" }), code("BAD_REQUEST"));

  await assert.rejects(repository.create("w1", user, "events", { title: "E", chapterId: "c9" }), (error) => error.params?.field === "chapterId");
  await assert.rejects(repository.create("w1", user, "events", { title: "E", participantIds: [a.id, "gone"] }), (error) => error.params?.field === "participantIds");
  await assert.rejects(repository.create("w1", user, "events", { title: "E", locationId: a.id }), (error) => error.params?.field === "locationId");
  await assert.rejects(repository.create("w1", user, "events", { title: "E", threadIds: ["gone"] }), (error) => error.params?.field === "threadIds");
  await assert.rejects(repository.create("w1", user, "events", { title: "E", storyOrder: 1.5 }), code("BAD_REQUEST"));
  await assert.rejects(repository.create("w1", user, "setups", { description: "S", plantedIn: { kind: "event", id: "gone" } }), (error) => error.params?.field === "plantedIn");
  await assert.rejects(repository.create("w1", user, "setups", { description: "S", plantedIn: { kind: "scene", id: "c1" } }), code("BAD_REQUEST"));

  const first = (await repository.create("w1", user, "events", { title: "First", chapterId: "c1", participantIds: [a.id], locationId: place.id, threadIds: [thread.id] })).item;
  const second = (await repository.create("w1", user, "events", { title: "Second" })).item;
  assert.deepEqual([first.storyOrder, second.storyOrder], [1, 2]);
  const setup = (await repository.create("w1", user, "setups", { description: "A sign", plantedIn: { kind: "event", id: first.id }, paidOffIn: { kind: "chapter", id: "c2" }, status: "paid" })).item;
  assert.deepEqual(setup.plantedIn, { kind: "event", id: first.id });

  // A card keeps its kind; its questions would not carry over.
  await assert.rejects(repository.update("w1", user, "entities", a.id, { baseRevision: 1, type: "rule" }), code("CANON_ENTITY_TYPE_UNSUPPORTED"));
  await assert.rejects(repository.update("w1", user, "entities", a.id, { baseRevision: 1, name: "" }), code("CANON_NAME_REQUIRED"));
  await assert.rejects(repository.update("w1", user, "entities", a.id, { name: "x" }), code("BASE_REVISION_REQUIRED"));
  await assert.rejects(repository.remove("w1", user, "entities", a.id, {}), code("BASE_REVISION_REQUIRED"));
  await assert.rejects(repository.remove("w1", user, "entities", a.id, { baseRevision: 9 }), code("REVISION_CONFLICT"));
  assert.equal((await work()).canon.entities.find((entity) => entity.id === a.id).revision, 1);
});

test("revisions: an unchanged save moves nothing; a real change moves the object and the canon revision", async () => {
  const { repository, work } = await fixture("revisions");
  const user = LOCAL_USER;
  const created = await repository.create("w1", user, "entities", { type: "character", name: "A", card: { want: "x" } });
  const same = await repository.update("w1", user, "entities", created.item.id, { baseRevision: 1, name: "A", card: { want: "x" } });
  assert.equal(same.item.revision, 1);
  assert.equal(same.canonRevision, created.canonRevision);

  const cleared = await repository.update("w1", user, "entities", created.item.id, { baseRevision: 1, card: { want: "" }, summary: "Now described" });
  assert.equal(cleared.item.revision, 2);
  assert.deepEqual(cleared.item.card, {});
  assert.equal(cleared.canonRevision, created.canonRevision + 1);
  assert.equal((await work()).canonRevision, cleared.canonRevision);
  assert.equal((await repository.read("w1", user)).canonRevision, cleared.canonRevision);
});

test("invalidation: a change reaches exactly what was built on the changed object", async () => {
  const { store, repository, work } = await fixture("invalidation");
  const user = LOCAL_USER;
  const a = (await repository.create("w1", user, "entities", { type: "character", name: "A", summary: "First" })).item;
  const b = (await repository.create("w1", user, "entities", { type: "character", name: "B", summary: "Second" })).item;
  const relation = (await repository.create("w1", user, "relations", { fromId: a.id, toId: b.id, kind: "ally" })).item;
  const event = (await repository.create("w1", user, "events", { title: "Meeting", chapterId: "c1", participantIds: [b.id] })).item;

  const seed = () => store.transact((db) => {
    const stored = db.works[0];
    const record = (id, factId) => ({ id, chapterId: "none", status: "ready", context: { factVersions: [{ id: factId, revision: 1 }] } });
    stored.generationRecords = [
      record("uses_a", `derived:entity:${a.id}`),
      record("uses_b", `derived:entity:${b.id}`),
      record("uses_relation", `derived:relation:${relation.id}`),
      record("uses_event", `derived:event:${event.id}`),
      record("uses_stored_fact", "fact_about_a")
    ];
    stored.canon.facts = [
      { id: "fact_about_a", subjectId: a.id, predicate: "trade", value: "smith" },
      { id: "fact_unrelated", predicate: "weather", value: "fog" }
    ];
    stored.chapters[1].chapterMemory = { status: "confirmed", summary: "s", context: { factVersions: [{ id: `derived:relation:${relation.id}`, revision: 1 }] } };
  });
  const flagged = async () => {
    const stored = await work();
    return {
      records: stored.generationRecords.filter((record) => record.needsReview).map((record) => record.id).sort(),
      facts: stored.canon.facts.filter((fact) => fact.needsReview).map((fact) => fact.id),
      memory: stored.chapters[1].chapterMemory.status,
      reasons: [...new Set(stored.generationRecords.map((record) => record.reviewReason).filter(Boolean))]
    };
  };

  // Editing A's card: only what used A's card.
  await seed();
  const edited = await repository.update("w1", user, "entities", a.id, { baseRevision: 1, summary: "First, revised" });
  assert.deepEqual(edited.impacts.generationRecordIds, ["uses_a"]);
  assert.deepEqual(await flagged(), { records: ["uses_a"], facts: [], memory: "confirmed", reasons: [REASON_CHANGED] });

  // Renaming A: also the relation that spells A's name, and the chapter memory built on it.
  await seed();
  await repository.update("w1", user, "entities", a.id, { baseRevision: 2, name: "A the Elder" });
  assert.deepEqual(await flagged(), { records: ["uses_a", "uses_relation"], facts: [], memory: "stale", reasons: [REASON_CHANGED] });

  // Renaming B reaches the event B takes part in; A's card is untouched.
  await seed();
  await repository.update("w1", user, "entities", b.id, { baseRevision: 1, name: "B the Younger" });
  assert.deepEqual((await flagged()).records, ["uses_b", "uses_event", "uses_relation"]);

  // Changing the relation: only what used the relation.
  await seed();
  await repository.update("w1", user, "relations", relation.id, { baseRevision: 1, kind: "rival" });
  assert.deepEqual(await flagged(), { records: ["uses_relation"], facts: [], memory: "stale", reasons: [REASON_CHANGED] });

  // A thread has no fact of its own: nothing depends on it.
  await seed();
  const thread = (await repository.create("w1", user, "threads", { name: "Main" })).item;
  await repository.update("w1", user, "threads", thread.id, { baseRevision: 1, name: "Main line" });
  assert.deepEqual((await flagged()).records, []);

  // Removing A: its card, its relation, and the stored facts about it wait for review.
  await seed();
  const removed = await repository.remove("w1", user, "entities", a.id, { baseRevision: 3 });
  assert.deepEqual(removed.removed.relationIds, [relation.id]);
  assert.deepEqual(removed.impacts.factIds, ["fact_about_a"]);
  assert.deepEqual(await flagged(), { records: ["uses_a", "uses_relation", "uses_stored_fact"], facts: ["fact_about_a"], memory: "stale", reasons: [REASON_REMOVED] });
  const stored = await work();
  assert.deepEqual(stored.canon.entities.map((entity) => entity.id), [b.id]);
  assert.deepEqual(stored.canon.relations, []);
  assert.deepEqual(stored.canon.events[0].participantIds, [b.id]);
});

test("ownership: another user cannot read or change the story's objects", async () => {
  const { repository, work } = await fixture("ownership");
  const item = (await repository.create("w1", LOCAL_USER, "entities", { type: "character", name: "A" })).item;
  const stranger = { id: "someone-else" };
  await assert.rejects(repository.read("w1", stranger), code("NOT_FOUND"));
  await assert.rejects(repository.create("w1", stranger, "entities", { type: "character", name: "B" }), code("NOT_FOUND"));
  await assert.rejects(repository.update("w1", stranger, "entities", item.id, { baseRevision: 1, name: "Taken" }), code("NOT_FOUND"));
  await assert.rejects(repository.remove("w1", stranger, "entities", item.id, { baseRevision: 1 }), code("NOT_FOUND"));
  await assert.rejects(repository.read("w1", null), code("AUTH_REQUIRED"));
  assert.deepEqual((await work()).canon.entities.map((entity) => entity.name), ["A"]);
});
