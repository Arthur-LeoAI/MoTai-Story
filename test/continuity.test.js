const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DATABASE_SCHEMA_VERSION,
  applyCanonProposal,
  canAcceptGeneration,
  hashChapterContent,
  hasBlockingConflicts,
  isChapterMemoryStale,
  normalizeCanon,
  normalizeConflict,
  normalizeGenerationRecord,
  selectContinuityContext,
  upgradeDatabase
} = require("../src/continuity");

const at = "2026-09-03T01:02:03.000Z";

test("continuity normalizers are pure, bounded and stable", () => {
  const input = {
    status: "ready",
    entities: [{ id: "person_1", type: "character", name: " 林舟 ", aliases: ["小舟", "小舟", 3] }],
    facts: [{ id: "fact_1", category: "life_status", subjectId: "person_1", predicate: "状态", value: " 存活 ", strength: "hard", status: "active" }]
  };
  const snapshot = structuredClone(input);
  const first = normalizeCanon(input);
  const second = normalizeCanon(input);

  assert.deepEqual(input, snapshot);
  assert.deepEqual(first, second);
  assert.deepEqual(first.entities[0].aliases, ["小舟"]);
  assert.equal(first.facts[0].value, "存活");
  assert.equal(normalizeGenerationRecord({ rewriteCount: 99, attempts: new Array(5).fill({}) }).rewriteCount, 2);
});

test("hard conflicts cannot be dismissed and block acceptance", () => {
  const hard = normalizeConflict({ id: "c1", severity: "hard", status: "dismissed", message: "人物已经死亡" });
  const soft = normalizeConflict({ id: "c2", severity: "soft", status: "dismissed", message: "语气轻微偏差" });
  assert.equal(hard.status, "open");
  assert.equal(soft.status, "dismissed");
  assert.equal(hasBlockingConflicts([hard, soft]), true);
  assert.equal(canAcceptGeneration({
    status: "ready",
    attempts: [{ index: 0, status: "completed", output: "正文" }],
    conflicts: [hard]
  }), false);
  assert.equal(canAcceptGeneration({
    status: "ready",
    attempts: [{ index: 0, status: "completed", output: "正文" }],
    conflicts: [{ severity: "soft", status: "open" }]
  }), true);
  assert.equal(canAcceptGeneration({ status: "blocked", attempts: [{ status: "completed", output: "正文" }] }), false);
});

test("chapter content hash is newline-stable and detects stale memory", () => {
  const hash = hashChapterContent("第一行\r\n第二行");
  assert.equal(hash, hashChapterContent("第一行\n第二行"));
  const chapter = {
    content: "第一行\n第二行",
    chapterMemory: { status: "confirmed", sourceContentHash: hash, summary: "开场" }
  };
  assert.equal(isChapterMemoryStale(chapter), false);
  assert.equal(isChapterMemoryStale({ ...chapter, content: `${chapter.content}\n新增` }), true);
  assert.equal(isChapterMemoryStale({ content: "", chapterMemory: { status: "empty" } }), false);
});

test("context selection uses active facts and only prior confirmed fresh memories", () => {
  const chapter1 = { id: "ch_1", content: "一", chapterMemory: { status: "confirmed", sourceContentHash: hashChapterContent("一"), summary: "第一章" } };
  const chapter2 = { id: "ch_2", content: "二（已改）", chapterMemory: { status: "confirmed", sourceContentHash: hashChapterContent("二"), summary: "旧摘要" } };
  const chapter3 = { id: "ch_3", content: "三", chapterMemory: { status: "confirmed", sourceContentHash: hashChapterContent("三"), summary: "第三章" } };
  const work = {
    canon: {
      status: "ready",
      facts: [
        { id: "soft", predicate: "口吻", value: "克制", strength: "soft", status: "active" },
        { id: "hard", predicate: "生死", value: "存活", strength: "hard", status: "active", effectiveOrder: 0 },
        { id: "future", predicate: "生死", value: "死亡", strength: "hard", status: "active", effectiveOrder: 9 },
        { id: "old", predicate: "地点", value: "旧城", status: "superseded" }
      ]
    },
    chapters: [chapter1, chapter2, chapter3]
  };
  const context = selectContinuityContext(work, "ch_3", { recentChapterCount: 3 });
  assert.deepEqual(context.canonFactIds, ["hard", "soft"]);
  assert.deepEqual(context.chapterMemoryChapterIds, ["ch_1"]);
  assert.equal(context.chapterMemories[0].summary, "第一章");
});

test("canon proposals apply atomically without mutating inputs", () => {
  const canon = normalizeCanon({
    status: "ready",
    facts: [{ id: "fact_old", predicate: "地点", value: "旧城", status: "active", strength: "hard" }]
  });
  const proposal = {
    id: "cp_1",
    status: "pending",
    changes: [
      { operation: "supersede", targetFactId: "fact_old", fact: { id: "fact_new", predicate: "地点", value: "星港", strength: "hard" } },
      { operation: "add", fact: { id: "fact_friend", predicate: "关系", value: "盟友", strength: "soft" } }
    ]
  };
  const canonBefore = structuredClone(canon);
  const proposalBefore = structuredClone(proposal);
  const applied = applyCanonProposal(canon, proposal, { decidedAt: at });

  assert.deepEqual(canon, canonBefore);
  assert.deepEqual(proposal, proposalBefore);
  assert.equal(applied.proposal.status, "accepted");
  assert.equal(applied.proposal.decidedAt, at);
  assert.equal(applied.canon.facts.find((fact) => fact.id === "fact_old").status, "superseded");
  assert.equal(applied.canon.facts.find((fact) => fact.id === "fact_new").supersedesFactId, "fact_old");
  assert.throws(() => applyCanonProposal(canon, applied.proposal), (error) => error.status === 409);

  assert.throws(() => applyCanonProposal(canon, {
    id: "cp_bad",
    status: "pending",
    changes: [
      { operation: "add", fact: { id: "new_before_failure", predicate: "事件", value: "发生" } },
      { operation: "resolve", targetFactId: "missing" }
    ]
  }), (error) => error.status === 409);
  assert.deepEqual(canon, canonBefore);
});

test("accepted proposal facts retain their canonical IDs across reloads", () => {
  const fact = { id: "fact_shared", predicate: "地点", value: "星港" };
  const database = { works: [{ id: "work_one", canon: { facts: [fact] }, canonProposals: [{ id: "proposal_one", status: "accepted", changes: [{ operation: "add", fact }] }] }] };
  const first = upgradeDatabase(database).db;
  assert.equal(first.works[0].canonProposals[0].changes[0].fact.id, "fact_shared");
  assert.deepEqual(upgradeDatabase(first).db, first);
});

test("legacy database upgrade is additive, stable and idempotent", () => {
  let sequence = 0;
  const legacy = {
    works: [{
      id: "work_1",
      title: "旧作品",
      storyBible: { characters: "林舟：维修学徒" },
      chapters: [{ id: "chapter_1", title: "第一章", content: "开场" }],
      canon: {
        status: "draft",
        entities: [{ type: "character", name: "林舟" }],
        facts: [{ predicate: "身份", value: "维修学徒" }]
      },
      generationRecords: [{
        chapterId: "chapter_1",
        status: "blocked",
        conflicts: [{ severity: "hard", status: "open", message: "身份冲突" }]
      }],
      canonProposals: [{
        status: "pending",
        changes: [{ operation: "add", fact: { predicate: "地点", value: "星港" } }]
      }]
    }]
  };
  const first = upgradeDatabase(legacy, { idFactory: (prefix) => `${prefix}_${++sequence}`, now: at });

  assert.equal(first.changed, true);
  assert.equal(first.db.schemaVersion, DATABASE_SCHEMA_VERSION);
  assert.equal(first.db.works[0].ownerId, "local");
  assert.equal(first.db.works[0].storyBible.characters, "林舟：维修学徒");
  assert.equal(first.db.works[0].chapters[0].chapterMemory.status, "empty");
  assert.match(first.db.works[0].canon.entities[0].id, /^entity_/);
  assert.match(first.db.works[0].canon.facts[0].id, /^fact_/);
  assert.match(first.db.works[0].generationRecords[0].id, /^generation_/);
  assert.match(first.db.works[0].generationRecords[0].conflicts[0].id, /^conflict_/);
  assert.match(first.db.works[0].canonProposals[0].changes[0].fact.id, /^fact_/);

  const second = upgradeDatabase(first.db, {
    idFactory: () => { throw new Error("idFactory must not run on an upgraded database"); },
    now: "2030-01-01T00:00:00.000Z"
  });
  assert.equal(second.changed, false);
  assert.deepEqual(second.db, first.db);
  assert.throws(() => upgradeDatabase({ schemaVersion: DATABASE_SCHEMA_VERSION + 1, works: [] }), /高于当前支持/);
});
