const crypto = require("node:crypto");

const { upgradeWorkspace } = require("./workspace");
const { appError } = require("./errors");
const DATABASE_SCHEMA_VERSION = 5;
const CONTINUITY_VERSION = 1;

const ENTITY_TYPES = new Set(["character", "location", "event", "faction", "item", "rule", "foreshadowing"]);
const FACT_CATEGORIES = new Set([
  "identity",
  "life_status",
  "ability",
  "knowledge",
  "relationship",
  "timeline",
  "world_rule",
  "location",
  "event_state",
  "foreshadowing",
  "other"
]);
const CONFLICT_CATEGORIES = new Set([...FACT_CATEGORIES, "repetition", "voice", "motivation", "causality"]);
const CANON_STATUSES = new Set(["empty", "draft", "ready"]);
const FACT_STRENGTHS = new Set(["hard", "soft"]);
const FACT_STATUSES = new Set(["active", "resolved", "superseded"]);
const MEMORY_STATUSES = new Set(["empty", "draft", "confirmed", "stale"]);
const GENERATION_STATUSES = new Set(["generating", "checking", "blocked", "ready", "accepted", "rejected", "failed"]);
const ATTEMPT_STATUSES = new Set(["completed", "failed"]);
const CONFLICT_SEVERITIES = new Set(["hard", "soft"]);
const CONFLICT_STATUSES = new Set(["open", "resolved", "dismissed"]);
const CONFLICT_SOURCES = new Set(["rule", "ai"]);
const RESOLUTION_TYPES = new Set(["rewrite", "false_positive", "canon_change"]);
const PROPOSAL_STATUSES = new Set(["pending", "accepted", "rejected"]);
const PROPOSAL_OPERATIONS = new Set(["add", "supersede", "resolve"]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function id(value) {
  return text(value, 120).replace(/[^a-zA-Z0-9:_-]/g, "");
}

function enumValue(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

function dateValue(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function nullableInteger(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.trunc(number))) : null;
}

function idList(value, limit = 500) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(id).filter(Boolean))].slice(0, limit);
}

function normalizeCanonEntity(value) {
  const source = isObject(value) ? value : {};
  return {
    id: id(source.id),
    type: enumValue(source.type, ENTITY_TYPES, "character"),
    name: text(source.name, 160),
    aliases: Array.isArray(source.aliases)
      ? [...new Set(source.aliases.map((item) => text(item, 160)).filter(Boolean))].slice(0, 30)
      : [],
    createdAt: dateValue(source.createdAt),
    updatedAt: dateValue(source.updatedAt)
  };
}

function normalizeCanonFact(value) {
  const source = isObject(value) ? value : {};
  return {
    ...source,
    id: id(source.id),
    category: enumValue(source.category, FACT_CATEGORIES, "other"),
    subjectId: id(source.subjectId),
    predicate: text(source.predicate, 120),
    value: text(source.value, 4000),
    objectId: id(source.objectId),
    strength: enumValue(source.strength, FACT_STRENGTHS, "hard"),
    status: enumValue(source.status, FACT_STATUSES, "active"),
    sourceChapterId: id(source.sourceChapterId),
    sourceGenerationId: id(source.sourceGenerationId),
    effectiveOrder: nullableInteger(source.effectiveOrder),
    supersedesFactId: id(source.supersedesFactId),
    supersededByFactId: id(source.supersededByFactId),
    createdAt: dateValue(source.createdAt),
    updatedAt: dateValue(source.updatedAt)
  };
}

function normalizeCanon(value) {
  const source = isObject(value) ? value : {};
  const entities = Array.isArray(source.entities)
    ? source.entities.map(normalizeCanonEntity).filter((item) => item.name)
    : [];
  const facts = Array.isArray(source.facts)
    ? source.facts.map(normalizeCanonFact).filter((item) => item.predicate || item.value || item.objectId)
    : [];
  return {
    version: CONTINUITY_VERSION,
    status: enumValue(source.status, CANON_STATUSES, facts.length ? "draft" : "empty"),
    entities,
    facts
  };
}

function normalizeChapterMemory(value) {
  const source = isObject(value) ? value : {};
  return {
    ...source,
    version: CONTINUITY_VERSION,
    status: enumValue(source.status, MEMORY_STATUSES, "empty"),
    sourceContentHash: text(source.sourceContentHash, 80).toLowerCase(),
    summary: text(source.summary, 6000),
    participantIds: idList(source.participantIds),
    locationIds: idList(source.locationIds),
    timeLabel: text(source.timeLabel, 240),
    timelineOrder: nullableInteger(source.timelineOrder),
    factIds: idList(source.factIds, 1000),
    completedEventIds: idList(source.completedEventIds),
    openForeshadowingIds: idList(source.openForeshadowingIds),
    updatedAt: dateValue(source.updatedAt)
  };
}

function normalizeConflictEvidence(value) {
  const source = isObject(value) ? value : {};
  return {
    factId: id(source.factId),
    chapterId: id(source.chapterId),
    excerpt: text(source.excerpt, 1000)
  };
}

function normalizeConflict(value) {
  const source = isObject(value) ? value : {};
  const severity = enumValue(source.severity, CONFLICT_SEVERITIES, "soft");
  let status = enumValue(source.status, CONFLICT_STATUSES, "open");
  if (severity === "hard" && status === "dismissed") status = "open";
  const resolutionSource = isObject(source.resolution) ? source.resolution : {};
  const resolution = {
    type: enumValue(resolutionSource.type, RESOLUTION_TYPES, ""),
    note: text(resolutionSource.note, 1000)
  };
  const locationSource = isObject(source.location) ? source.location : {};
  return {
    id: id(source.id),
    category: enumValue(source.category, CONFLICT_CATEGORIES, "other"),
    kind: enumValue(source.kind, new Set(["contradiction", "confirmation", "suggestion"]), ""),
    temporalUncertain: source.temporalUncertain === true,
    uncertain: source.uncertain === true,
    severity,
    status,
    detectedBy: enumValue(source.detectedBy, CONFLICT_SOURCES, "rule"),
    message: text(source.message, 2000),
    evidence: Array.isArray(source.evidence)
      ? source.evidence.slice(0, 20).map(normalizeConflictEvidence)
      : [],
    location: {
      start: nullableInteger(locationSource.start),
      end: nullableInteger(locationSource.end)
    },
    resolution: status === "open" ? { type: "", note: "" } : { ...resolutionSource, ...resolution },
    createdAt: dateValue(source.createdAt),
    resolvedAt: status === "open" ? "" : dateValue(source.resolvedAt)
  };
}

function normalizeUsage(value) {
  const source = isObject(value) ? value : {};
  return {
    inputTokens: nullableInteger(source.inputTokens),
    outputTokens: nullableInteger(source.outputTokens),
    totalTokens: nullableInteger(source.totalTokens)
  };
}

function normalizeGenerationAttempt(value, fallbackIndex = 0) {
  const source = isObject(value) ? value : {};
  return {
    index: nullableInteger(source.index) ?? fallbackIndex,
    status: enumValue(source.status, ATTEMPT_STATUSES, "failed"),
    output: typeof source.output === "string" ? source.output.slice(0, 200000) : "",
    error: text(source.error, 2000),
    usage: normalizeUsage(source.usage),
    startedAt: dateValue(source.startedAt),
    finishedAt: dateValue(source.finishedAt)
  };
}

function normalizeGenerationContext(value) {
  const source = isObject(value) ? value : {};
  return {
    ...source,
    canonFactIds: idList(source.canonFactIds, 2000),
    chapterMemoryChapterIds: idList(source.chapterMemoryChapterIds, 100),
    promptVersion: text(source.promptVersion, 80)
  };
}

function normalizeGenerationRecord(value) {
  const source = isObject(value) ? value : {};
  const attempts = Array.isArray(source.attempts)
    ? source.attempts.slice(0, 3).map((item, index) => normalizeGenerationAttempt(item, index))
    : [];
  return {
    ...source,
    id: id(source.id),
    chapterId: id(source.chapterId),
    mode: text(source.mode, 40) || "continue",
    status: enumValue(source.status, GENERATION_STATUSES, "failed"),
    provider: text(source.provider, 80),
    model: text(source.model, 160),
    instruction: text(source.instruction, 20000),
    baseContentHash: text(source.baseContentHash, 80).toLowerCase(),
    context: normalizeGenerationContext(source.context),
    attempts,
    selectedAttemptIndex: nullableInteger(source.selectedAttemptIndex, { min: 0, max: 2 }),
    conflicts: Array.isArray(source.conflicts) ? source.conflicts.slice(0, 200).map(normalizeConflict) : [],
    rewriteCount: nullableInteger(source.rewriteCount, { min: 0, max: 2 }) ?? 0,
    createdAt: dateValue(source.createdAt),
    completedAt: dateValue(source.completedAt),
    acceptedAt: dateValue(source.acceptedAt)
  };
}

function normalizeProposalChange(value) {
  const source = isObject(value) ? value : {};
  const operation = enumValue(source.operation, PROPOSAL_OPERATIONS, "add");
  return {
    operation,
    targetFactId: id(source.targetFactId),
    fact: isObject(source.fact) ? normalizeCanonFact(source.fact) : null
  };
}

function normalizeCanonProposal(value) {
  const source = isObject(value) ? value : {};
  return {
    ...source,
    id: id(source.id),
    generationRecordId: id(source.generationRecordId),
    chapterId: id(source.chapterId),
    status: enumValue(source.status, PROPOSAL_STATUSES, "pending"),
    changes: Array.isArray(source.changes) ? source.changes.slice(0, 500).map(normalizeProposalChange) : [],
    chapterMemory: normalizeChapterMemory(source.chapterMemory),
    createdAt: dateValue(source.createdAt),
    decidedAt: dateValue(source.decidedAt)
  };
}

function normalizeWorkContinuity(value) {
  const source = isObject(value) ? value : {};
  return {
    ownerId: id(source.ownerId) || "local",
    canon: normalizeCanon(source.canon),
    generationRecords: Array.isArray(source.generationRecords)
      ? source.generationRecords.map(normalizeGenerationRecord)
      : [],
    canonProposals: Array.isArray(source.canonProposals)
      ? source.canonProposals.map(normalizeCanonProposal)
      : []
  };
}

function hashChapterContent(chapterOrContent) {
  const content = isObject(chapterOrContent) ? chapterOrContent.content : chapterOrContent;
  return crypto.createHash("sha256").update(String(content || "").replace(/\r\n?/g, "\n"), "utf8").digest("hex");
}

function isChapterMemoryStale(chapter) {
  const memory = normalizeChapterMemory(chapter?.chapterMemory);
  if (memory.status === "empty") return false;
  if (memory.status === "stale" || !memory.sourceContentHash) return true;
  return memory.sourceContentHash !== hashChapterContent(chapter);
}

function getActiveCanonFacts(canon, chapterOrder = Number.MAX_SAFE_INTEGER) {
  const order = nullableInteger(chapterOrder) ?? Number.MAX_SAFE_INTEGER;
  return normalizeCanon(canon).facts
    .filter((fact) => fact.status === "active" && (fact.effectiveOrder === null || fact.effectiveOrder <= order))
    .sort((left, right) => {
      if (left.strength !== right.strength) return left.strength === "hard" ? -1 : 1;
      const leftOrder = left.effectiveOrder ?? -1;
      const rightOrder = right.effectiveOrder ?? -1;
      return leftOrder - rightOrder || left.id.localeCompare(right.id);
    });
}

function selectContinuityContext(work, chapterIdValue, options = {}) {
  const source = isObject(work) ? work : {};
  const chapters = Array.isArray(source.chapters) ? source.chapters : [];
  const chapterId = id(chapterIdValue);
  const currentIndex = chapters.findIndex((chapter) => id(chapter?.id) === chapterId);
  const effectiveIndex = currentIndex < 0 ? chapters.length : currentIndex;
  const maxFacts = nullableInteger(options.maxFacts, { min: 0, max: 2000 }) ?? 200;
  const recentChapterCount = nullableInteger(options.recentChapterCount, { min: 0, max: 20 }) ?? 3;
  const canonFacts = getActiveCanonFacts(source.canon, effectiveIndex).slice(0, maxFacts);
  const chapterMemories = chapters
    .slice(0, effectiveIndex)
    .map((chapter, index) => ({ chapterId: id(chapter?.id), chapterOrder: index, memory: normalizeChapterMemory(chapter?.chapterMemory), chapter }))
    .filter((entry) => entry.chapterId && entry.memory.status === "confirmed" && !isChapterMemoryStale(entry.chapter))
    .slice(-recentChapterCount)
    .map(({ chapterId: memoryChapterId, chapterOrder, memory }) => ({ chapterId: memoryChapterId, chapterOrder, ...memory }));
  return {
    canonFacts,
    chapterMemories,
    canonFactIds: canonFacts.map((fact) => fact.id).filter(Boolean),
    chapterMemoryChapterIds: chapterMemories.map((memory) => memory.chapterId)
  };
}

function hasBlockingConflicts(value) {
  const conflicts = Array.isArray(value) ? value : value?.conflicts;
  return Array.isArray(conflicts)
    && conflicts.map(normalizeConflict).some((conflict) => conflict.severity === "hard" && conflict.status === "open");
}

function canAcceptGeneration(value) {
  const record = normalizeGenerationRecord(value);
  if (record.status !== "ready" || hasBlockingConflicts(record)) return false;
  const selected = record.selectedAttemptIndex === null
    ? record.attempts.at(-1)
    : record.attempts.find((attempt) => attempt.index === record.selectedAttemptIndex);
  return Boolean(selected && selected.status === "completed" && selected.output.trim());
}

function domainError(code, params) {
  return appError(code, params);
}

function applyCanonProposal(canonValue, proposalValue, options = {}) {
  const canon = normalizeCanon(canonValue);
  const proposal = normalizeCanonProposal(proposalValue);
  if (proposal.status !== "pending") throw domainError("CANON_PROPOSAL_ALREADY_HANDLED");
  if (!proposal.id || !proposal.changes.length) throw domainError("CANON_PROPOSAL_INCOMPLETE");

  const facts = canon.facts.map((fact) => ({ ...fact }));
  const byId = new Map(facts.filter((fact) => fact.id).map((fact) => [fact.id, fact]));
  for (const change of proposal.changes) {
    if (change.operation === "add") {
      if (!change.fact?.id || byId.has(change.fact.id)) throw domainError("CANON_FACT_ID_CONFLICT");
      const added = { ...change.fact, status: "active" };
      facts.push(added);
      byId.set(added.id, added);
      continue;
    }

    const target = byId.get(change.targetFactId);
    if (!target || target.status !== "active") throw domainError("CANON_FACT_NOT_ACTIVE");
    if (change.operation === "resolve") {
      target.status = "resolved";
      target.updatedAt = dateValue(options.decidedAt) || proposal.decidedAt || target.updatedAt;
      continue;
    }

    if (!change.fact?.id || byId.has(change.fact.id)) throw domainError("CANON_FACT_ID_CONFLICT");
    target.status = "superseded";
    target.supersededByFactId = change.fact.id;
    target.updatedAt = dateValue(options.decidedAt) || proposal.decidedAt || target.updatedAt;
    const replacement = { ...change.fact, status: "active", supersedesFactId: target.id };
    facts.push(replacement);
    byId.set(replacement.id, replacement);
  }

  const decidedAt = dateValue(options.decidedAt) || proposal.decidedAt;
  return {
    canon: { ...canon, status: facts.length ? "ready" : "empty", facts },
    proposal: { ...proposal, status: "accepted", decidedAt }
  };
}

function cloneJson(value) {
  if (!isObject(value)) return {};
  return JSON.parse(JSON.stringify(value));
}

function upgradeDatabase(value, options = {}) {
  const source = cloneJson(value);
  const original = JSON.stringify(source);
  const incomingVersion = nullableInteger(source.schemaVersion) ?? 0;
  if (incomingVersion > DATABASE_SCHEMA_VERSION) {
    throw domainError("DATABASE_VERSION_UNSUPPORTED", { incoming: incomingVersion, supported: DATABASE_SCHEMA_VERSION });
  }
  const makeId = typeof options.idFactory === "function"
    ? options.idFactory
    : (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const currentTime = dateValue(typeof options.now === "function" ? options.now() : options.now) || new Date().toISOString();
  const used = new Set();
  const stableId = (candidate, prefix) => {
    let next = id(candidate);
    if (!next || used.has(next)) {
      do next = id(makeId(prefix)); while (!next || used.has(next));
    }
    used.add(next);
    return next;
  };

  const works = Array.isArray(source.works) ? source.works : [];
  source.works = works.filter(isObject).map((rawWork) => {
    const normalized = normalizeWorkContinuity(rawWork);
    const work = {
      ...rawWork,
      ownerId: normalized.ownerId,
      canon: normalized.canon,
      generationRecords: normalized.generationRecords,
      canonProposals: normalized.canonProposals
    };
    work.id = stableId(work.id, "work");
    const entityIds = new Set();
    work.canon.entities = work.canon.entities.map((entity) => {
      const entityId = stableId(entity.id, "entity");
      entityIds.add(entityId);
      return { ...entity, id: entityId, createdAt: entity.createdAt || currentTime, updatedAt: entity.updatedAt || currentTime };
    });
    work.canon.facts = work.canon.facts.map((fact) => ({
      ...fact,
      id: stableId(fact.id, "fact"),
      createdAt: fact.createdAt || currentTime,
      updatedAt: fact.updatedAt || currentTime
    }));
    work.chapters = (Array.isArray(rawWork.chapters) ? rawWork.chapters : []).filter(isObject).map((rawChapter) => ({
      ...rawChapter,
      id: stableId(rawChapter.id, "chapter"),
      chapterMemory: normalizeChapterMemory(rawChapter.chapterMemory)
    }));
    work.generationRecords = work.generationRecords.map((record) => ({
      ...record,
      id: stableId(record.id, "generation"),
      createdAt: record.createdAt || currentTime,
      conflicts: record.conflicts.map((conflict) => ({
        ...conflict,
        id: stableId(conflict.id, "conflict"),
        createdAt: conflict.createdAt || currentTime
      }))
    }));
    work.canonProposals = work.canonProposals.map((proposal) => ({
      ...proposal,
      id: stableId(proposal.id, "canon_proposal"),
      createdAt: proposal.createdAt || currentTime,
      changes: proposal.changes.map((change) => ({
        ...change,
        fact: change.fact
          ? {
              ...change.fact,
              id: proposal.status === "accepted" && change.fact.id
                ? change.fact.id
                : stableId(change.fact.id, "fact"),
              createdAt: change.fact.createdAt || currentTime,
              updatedAt: change.fact.updatedAt || currentTime
            }
          : null
      }))
    }));
    return work;
  });
  source.schemaVersion = DATABASE_SCHEMA_VERSION;
  source.storeRevision ||= 0;
  upgradeWorkspace(source);
  return { db: source, changed: JSON.stringify(source) !== original };
}

module.exports = {
  DATABASE_SCHEMA_VERSION,
  CONTINUITY_VERSION,
  applyCanonProposal,
  canAcceptGeneration,
  getActiveCanonFacts,
  hashChapterContent,
  hasBlockingConflicts,
  isChapterMemoryStale,
  normalizeCanon,
  normalizeCanonEntity,
  normalizeCanonFact,
  normalizeCanonProposal,
  normalizeChapterMemory,
  normalizeConflict,
  normalizeGenerationRecord,
  normalizeWorkContinuity,
  selectContinuityContext,
  upgradeDatabase
};
