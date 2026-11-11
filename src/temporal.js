"use strict";
const { appError } = require("./errors");

// Story intervals are half-open [from, until). Reader order is independent of
// story time so flashbacks do not accidentally reveal later information.
function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeTemporalFact(fact = {}) {
  return {
    ...fact,
    sourceRevision: Number.isSafeInteger(fact.sourceRevision) && fact.sourceRevision >= 0 ? fact.sourceRevision : null,
    excerpt: typeof fact.excerpt === "string" ? fact.excerpt : "",
    storyFrom: numberOrNull(fact.storyFrom),
    storyUntil: numberOrNull(fact.storyUntil),
    readerOrder: numberOrNull(fact.readerOrder ?? fact.effectiveOrder),
    scope: ["truth", "belief", "author"].includes(fact.scope) ? fact.scope : "truth",
    knowerId: typeof fact.knowerId === "string" ? fact.knowerId : "",
    belief: ["knows", "believes", "mistaken"].includes(fact.belief) ? fact.belief : "knows",
    needsReview: fact.needsReview === true
  };
}

function selectTemporalFacts(facts = [], { storyTime = null, readerOrder = null, povId = "" } = {}) {
  const time = numberOrNull(storyTime);
  const order = numberOrNull(readerOrder);
  return facts.map(normalizeTemporalFact).filter((fact) => {
    if (fact.needsReview || fact.status === "stale" || fact.scope === "author") return false;
    if (fact.readerOrder !== null && (order === null || fact.readerOrder > order)) return false;
    if (fact.scope === "belief" && (!povId || fact.knowerId !== povId)) return false;
    if (fact.storyFrom !== null && fact.storyUntil !== null && fact.storyUntil <= fact.storyFrom) return false;
    if (time !== null && ((fact.storyFrom !== null && time < fact.storyFrom) || (fact.storyUntil !== null && time >= fact.storyUntil))) return false;
    if (fact.status === "superseded" && (time === null || fact.storyFrom === null || fact.storyUntil === null)) return false;
    return !fact.status || ["active", "resolved", "superseded"].includes(fact.status);
  }).map((fact) => ({
    ...fact,
    // Unknown placement and a character's beliefs are evidence to confirm,
    // never an unconditional world-state constraint.
    temporalUncertain: time === null || fact.storyFrom === null,
    strength: (time === null || fact.storyFrom === null || fact.scope === "belief") ? "soft" : fact.strength
  }));
}

function referencedIds(context = {}, kind) {
  const modern = kind === "fact" ? context.factVersions : context.chapterVersions;
  const legacy = kind === "fact" ? context.canonFactIds : context.chapterMemoryChapterIds;
  return [...(Array.isArray(modern) ? modern.map((entry) => entry.id) : []), ...(Array.isArray(legacy) ? legacy : [])];
}

// Mutates only validity metadata, never prose. The caller persists this within
// its transaction. Fixed-point propagation follows recorded dependencies only.
function invalidateDependencies(work, { chapterId, factIds = [], reason = "来源已修改" } = {}) {
  const chapters = new Set(chapterId ? [chapterId] : []);
  const facts = new Set(factIds);
  const impacts = { chapterIds: [], factIds: [], generationRecordIds: [] };
  const affectedMemories = new Set();
  const affectedFacts = new Set();
  const affectedRecords = new Set();
  const depends = (context) => referencedIds(context, "chapter").some((id) => chapters.has(id)) || referencedIds(context, "fact").some((id) => facts.has(id));
  let changed;
  do {
    changed = false;
    for (const fact of work.canon?.facts || []) {
      if (!affectedFacts.has(fact.id) && (facts.has(fact.id) || chapters.has(fact.sourceChapterId) || depends(fact.context))) {
        fact.needsReview = true;
        fact.reviewReason = reason;
        facts.add(fact.id);
        affectedFacts.add(fact.id);
        changed = true;
      }
    }
    for (const chapter of work.chapters || []) {
      const memory = chapter.chapterMemory;
      if (!memory || affectedMemories.has(chapter.id)) continue;
      if (chapters.has(chapter.id) || depends(memory.context) || (memory.factIds || []).some((id) => facts.has(id))) {
        memory.status = "stale";
        memory.reviewReason = reason;
        chapters.add(chapter.id);
        affectedMemories.add(chapter.id);
        changed = true;
      }
    }
    for (const record of work.generationRecords || []) {
      if (!affectedRecords.has(record.id) && (chapters.has(record.chapterId) || depends(record.context))) {
        record.needsReview = true;
        record.reviewReason = reason;
        affectedRecords.add(record.id);
        changed = true;
      }
    }
  } while (changed);
  impacts.chapterIds = [...affectedMemories];
  impacts.factIds = [...affectedFacts];
  impacts.generationRecordIds = [...affectedRecords];
  return impacts;
}

function classifyConflict(conflict = {}) {
  if (["voice", "style", "wording", "pacing", "repetition"].includes(conflict.category) || conflict.kind === "suggestion") return "suggestion";
  const evidenced = Array.isArray(conflict.evidence) && conflict.evidence.some((item) => item && (item.factId || item.chapterId) && typeof item.excerpt === "string" && item.excerpt.trim());
  if (conflict.severity === "hard" && evidenced && !conflict.temporalUncertain && !conflict.uncertain) return "contradiction";
  return "confirmation";
}

function adjudicateConflict(record, conflictId, { reason, baseRevision, canonRevision, currentRevision, currentCanonRevision } = {}) {
  const fail = (code) => { throw appError(code); };
  if (![baseRevision, canonRevision, currentRevision, currentCanonRevision].every((value) => Number.isSafeInteger(value) && value >= 0)) fail("REVISIONS_REQUIRED");
  if (baseRevision !== currentRevision || canonRevision !== currentCanonRevision || record.needsReview) fail("REVIEW_BASIS_STALE");
  if (typeof reason !== "string" || !reason.trim()) fail("ADJUDICATION_REASON_REQUIRED");
  const conflict = (record.conflicts || []).find((item) => item.id === conflictId);
  if (!conflict) fail("CONFLICT_NOT_FOUND");
  conflict.status = "resolved";
  conflict.resolution = { type: "false_positive", note: reason.trim(), baseRevision, canonRevision, evidence: structuredClone(conflict.evidence || []) };
  return conflict;
}

module.exports = { normalizeTemporalFact, selectTemporalFacts, invalidateDependencies, classifyConflict, adjudicateConflict };
