"use strict";

// Data model v6: the structured story objects that live in `work.canon`
// beside the low-level facts.
//
//   entities   who and what exists (character, location, faction, item, rule)
//   relations  how two entities stand to each other, optionally over story time
//   events     what happens: story order, and the chapter that tells it
//   threads    plot lines that events belong to
//   setups     foreshadowing: where it is planted and where it pays off
//
// Canon is the single source of structured story data. `work.storyBible` stays
// as free-text notes. Facts remain the record the consistency checks read; the
// objects here reach those checks through `deriveCanonFacts`, which is computed
// on every read and never stored, so it cannot drift from its source.

// "event" and "foreshadowing" are entity types of the v5 model. They are still
// read, but new entities use the five card types; events and setups are
// first-class objects now.
const ENTITY_TYPES = Object.freeze(["character", "location", "event", "faction", "item", "rule", "foreshadowing"]);
const CARD_ENTITY_TYPES = Object.freeze(["character", "location", "faction", "item", "rule"]);

// The few key questions of each card. Keys only: labels are translated by the
// interface, and by `PROMPT_LABELS` below for prompts.
const CARD_FIELDS = Object.freeze({
  character: Object.freeze(["want", "obstacle", "change", "appearance", "voice", "secret", "background"]),
  location: Object.freeze(["atmosphere", "occupants"]),
  faction: Object.freeze(["want", "assets", "fear"]),
  item: Object.freeze(["purpose", "origin"]),
  rule: Object.freeze(["cost", "exception"]),
  event: Object.freeze([]),
  foreshadowing: Object.freeze([])
});

const RELATION_KINDS = Object.freeze(["family", "friend", "lover", "mentor", "rival", "enemy", "ally", "custom"]);
const SETUP_STATUSES = Object.freeze(["open", "paid", "dropped"]);
const SETUP_ANCHOR_KINDS = Object.freeze(["chapter", "event"]);
const CANON_COLLECTIONS = Object.freeze(["entities", "relations", "events", "threads", "setups"]);

const LIMITS = Object.freeze({
  name: 160,
  alias: 160,
  aliases: 30,
  summary: 600,
  cardField: 2000,
  notes: 20000,
  image: 500,
  label: 120,
  tension: 1000,
  eventTitle: 200,
  eventSummary: 4000,
  timeLabel: 240,
  setupDescription: 2000,
  references: 100
});

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function id(value) {
  return text(value, 120).replace(/[^a-zA-Z0-9:_-]/g, "");
}

function idList(value, limit = LIMITS.references) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(id).filter(Boolean))].slice(0, limit);
}

function dateValue(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function revisionValue(value) {
  return Number.isSafeInteger(value) && value >= 1 ? value : 1;
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function integerOrNull(value) {
  return Number.isSafeInteger(value) ? value : null;
}

// A colour is a palette key the interface maps to a design token, never a
// colour value.
function colorKey(value) {
  return typeof value === "string" && /^[a-z][a-z0-9-]{0,23}$/.test(value) ? value : "";
}

function ownerValue(value) {
  return id(value) || "local";
}

function normalizeCard(type, value) {
  const source = isObject(value) ? value : {};
  const card = {};
  for (const key of CARD_FIELDS[type] || []) {
    const field = text(source[key], LIMITS.cardField);
    if (field) card[key] = field;
  }
  return card;
}

function normalizeAliases(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => text(item, LIMITS.alias)).filter(Boolean))].slice(0, LIMITS.aliases)
    : [];
}

function normalizeEntity(value) {
  const source = isObject(value) ? value : {};
  const type = ENTITY_TYPES.includes(source.type) ? source.type : "character";
  return {
    id: id(source.id),
    ownerId: ownerValue(source.ownerId),
    type,
    name: text(source.name, LIMITS.name),
    aliases: normalizeAliases(source.aliases),
    summary: text(source.summary, LIMITS.summary),
    card: normalizeCard(type, source.card),
    notes: text(source.notes, LIMITS.notes),
    image: text(source.image, LIMITS.image),
    color: colorKey(source.color),
    revision: revisionValue(source.revision),
    createdAt: dateValue(source.createdAt),
    updatedAt: dateValue(source.updatedAt)
  };
}

function normalizeRelation(value) {
  const source = isObject(value) ? value : {};
  return {
    id: id(source.id),
    ownerId: ownerValue(source.ownerId),
    fromId: id(source.fromId),
    toId: id(source.toId),
    kind: RELATION_KINDS.includes(source.kind) ? source.kind : "custom",
    label: text(source.label, LIMITS.label),
    tension: text(source.tension, LIMITS.tension),
    // Story time, half-open [storyFrom, storyUntil), the same scale and meaning
    // as temporal facts and `scene.storyTime`. null = not placed in time.
    storyFrom: numberOrNull(source.storyFrom),
    storyUntil: numberOrNull(source.storyUntil),
    revision: revisionValue(source.revision),
    createdAt: dateValue(source.createdAt),
    updatedAt: dateValue(source.updatedAt)
  };
}

function normalizeEvent(value) {
  const source = isObject(value) ? value : {};
  return {
    id: id(source.id),
    ownerId: ownerValue(source.ownerId),
    title: text(source.title, LIMITS.eventTitle),
    summary: text(source.summary, LIMITS.eventSummary),
    // Position in story time. Only the order matters; the writer's own wording
    // ("three years earlier") is `timeLabel`.
    storyOrder: integerOrNull(source.storyOrder) ?? 0,
    timeLabel: text(source.timeLabel, LIMITS.timeLabel),
    // The chapter that tells it (reader order). Empty = not told yet.
    chapterId: id(source.chapterId),
    participantIds: idList(source.participantIds),
    locationId: id(source.locationId),
    threadIds: idList(source.threadIds),
    revision: revisionValue(source.revision),
    createdAt: dateValue(source.createdAt),
    updatedAt: dateValue(source.updatedAt)
  };
}

function normalizeThread(value) {
  const source = isObject(value) ? value : {};
  return {
    id: id(source.id),
    ownerId: ownerValue(source.ownerId),
    name: text(source.name, LIMITS.name),
    color: colorKey(source.color),
    revision: revisionValue(source.revision),
    createdAt: dateValue(source.createdAt),
    updatedAt: dateValue(source.updatedAt)
  };
}

function normalizeAnchor(value) {
  if (!isObject(value)) return null;
  const anchorId = id(value.id);
  return SETUP_ANCHOR_KINDS.includes(value.kind) && anchorId ? { kind: value.kind, id: anchorId } : null;
}

function normalizeSetup(value) {
  const source = isObject(value) ? value : {};
  return {
    id: id(source.id),
    ownerId: ownerValue(source.ownerId),
    description: text(source.description, LIMITS.setupDescription),
    plantedIn: normalizeAnchor(source.plantedIn),
    paidOffIn: normalizeAnchor(source.paidOffIn),
    status: SETUP_STATUSES.includes(source.status) ? source.status : "open",
    revision: revisionValue(source.revision),
    createdAt: dateValue(source.createdAt),
    updatedAt: dateValue(source.updatedAt)
  };
}

const NORMALIZERS = Object.freeze({
  entities: normalizeEntity,
  relations: normalizeRelation,
  events: normalizeEvent,
  threads: normalizeThread,
  setups: normalizeSetup
});

// One object, normalised but not yet judged complete (see REQUIRED).
function normalizeCanonObject(collection, value) {
  return NORMALIZERS[collection](value);
}

// What makes a stored object worth keeping at all.
const REQUIRED = Object.freeze({
  entities: (item) => Boolean(item.name),
  relations: (item) => Boolean(item.fromId && item.toId && item.fromId !== item.toId),
  events: (item) => Boolean(item.title),
  threads: (item) => Boolean(item.name),
  setups: (item) => Boolean(item.description)
});

function normalizeCanonObjects(value) {
  const source = isObject(value) ? value : {};
  const result = {};
  for (const collection of CANON_COLLECTIONS) {
    result[collection] = Array.isArray(source[collection])
      ? source[collection].map(NORMALIZERS[collection]).filter(REQUIRED[collection])
      : [];
  }
  return result;
}

// Removes references to objects that no longer exist. Mutates `canon`.
// Relations need both ends, so a relation that lost one is removed; every
// other reference is optional and is cleared. Chapter references are left
// alone: a chapter in the trash may come back, and derivation treats a
// missing chapter as "not told".
function repairCanonReferences(canon) {
  const entityIds = new Set((canon.entities || []).map((item) => item.id));
  const threadIds = new Set((canon.threads || []).map((item) => item.id));
  canon.relations = (canon.relations || []).filter((item) => entityIds.has(item.fromId) && entityIds.has(item.toId));
  for (const event of canon.events || []) {
    event.participantIds = event.participantIds.filter((item) => entityIds.has(item));
    if (event.locationId && !entityIds.has(event.locationId)) event.locationId = "";
    event.threadIds = event.threadIds.filter((item) => threadIds.has(item));
  }
  const eventIds = new Set((canon.events || []).map((item) => item.id));
  for (const setup of canon.setups || []) {
    if (setup.plantedIn?.kind === "event" && !eventIds.has(setup.plantedIn.id)) setup.plantedIn = null;
    if (setup.paidOffIn?.kind === "event" && !eventIds.has(setup.paidOffIn.id)) setup.paidOffIn = null;
  }
  return canon;
}

// ---------------------------------------------------------------------------
// Derived facts
// ---------------------------------------------------------------------------

const DERIVED_PREFIX = "derived";
const DERIVED_KINDS = Object.freeze({ entities: "entity", relations: "relation", events: "event", setups: "setup" });

function derivedFactId(kind, objectId) {
  return `${DERIVED_PREFIX}:${kind}:${objectId}`;
}

function isDerivedFactId(value) {
  return typeof value === "string" && value.startsWith(`${DERIVED_PREFIX}:`);
}

// Wording used inside prompts. It follows the language the story is written in
// (`work.language`), not the interface language.
const PROMPT_LABELS = Object.freeze({
  en: Object.freeze({
    separator: "; ",
    colon: ": ",
    listSeparator: ", ",
    aliases: "also called",
    tension: "Tension",
    time: "When",
    participants: "Who",
    location: "Where",
    setup: "Setup",
    setupOpen: "not paid off yet",
    setupPaid: "paid off",
    card: { want: "Wants", obstacle: "In the way / fears", change: "Becomes", appearance: "Looks", voice: "Speaks", secret: "Secret", background: "Background", atmosphere: "Atmosphere", occupants: "Who is here", assets: "Holds", fear: "Fears", purpose: "What it does", origin: "Where it comes from", cost: "Cost or limit", exception: "Exception" },
    kinds: { family: "family", friend: "friends", lover: "lovers", mentor: "mentor of", rival: "rivals", enemy: "enemies", ally: "allies", custom: "connected" },
    groups: { character: "Characters", location: "Places", faction: "Factions", item: "Things", rule: "Rules of the world", relation: "Relationships" }
  }),
  "zh-CN": Object.freeze({
    separator: "；",
    colon: "：",
    listSeparator: "、",
    aliases: "又称",
    tension: "张力",
    time: "时间",
    participants: "人物",
    location: "地点",
    setup: "伏笔",
    setupOpen: "尚未回收",
    setupPaid: "已回收",
    card: { want: "想要", obstacle: "阻碍/害怕", change: "结局时的变化", appearance: "外貌", voice: "说话方式", secret: "秘密", background: "背景", atmosphere: "氛围", occupants: "谁在这里", assets: "手里有什么", fear: "害怕", purpose: "用途", origin: "来历", cost: "代价或限制", exception: "例外" },
    kinds: { family: "家人", friend: "朋友", lover: "恋人", mentor: "师徒（前者为师）", rival: "对手", enemy: "敌人", ally: "盟友", custom: "有关联" },
    groups: { character: "人物", location: "地点", faction: "势力", item: "物品", rule: "世界规则", relation: "人物关系" }
  })
});

function promptLabels(language) {
  return PROMPT_LABELS[language === "en" ? "en" : "zh-CN"];
}

const ENTITY_FACT_CATEGORY = Object.freeze({
  character: "identity",
  location: "location",
  faction: "other",
  item: "other",
  rule: "world_rule",
  event: "event_state",
  foreshadowing: "foreshadowing"
});

function entityHeading(entity, labels) {
  return entity.aliases.length
    ? `${entity.name} (${labels.aliases} ${entity.aliases.join(labels.listSeparator)})`
    : entity.name;
}

function entityDescription(entity, labels) {
  return [
    entity.summary,
    ...(CARD_FIELDS[entity.type] || [])
      .filter((key) => entity.card[key])
      .map((key) => `${labels.card[key]}${labels.colon}${entity.card[key]}`)
  ].filter(Boolean).join(labels.separator);
}

function relationDescription(relation, labels) {
  const kind = relation.kind === "custom" && relation.label
    ? relation.label
    : `${labels.kinds[relation.kind]}${relation.label ? ` (${relation.label})` : ""}`;
  return [kind, relation.tension && `${labels.tension}${labels.colon}${relation.tension}`].filter(Boolean).join(labels.separator);
}

// The facts the structured objects stand for, in the shape `temporal.js`
// selects from. Recomputed on every call.
//
// - An entity card is one fact about that entity. Rules are hard constraints;
//   everything else on a card is guidance (soft).
// - A relation is a relationship fact over its story-time interval.
// - An event is known to the reader from the chapter that tells it. An event
//   with no live chapter is the author's plan and yields no fact, so writing
//   cannot reveal it early.
// - A setup is a foreshadowing fact from the chapter where it is planted;
//   a dropped one yields nothing, a paid one is recorded as resolved.
function deriveCanonFacts(work) {
  const canon = normalizeCanonObjects(work?.canon);
  const labels = promptLabels(work?.language);
  const chapterOrder = new Map((Array.isArray(work?.chapters) ? work.chapters : []).map((chapter, index) => [chapter?.id, index]));
  const names = new Map(canon.entities.map((entity) => [entity.id, entity.name]));
  const events = new Map(canon.events.map((event) => [event.id, event]));
  const base = { strength: "hard", status: "active", scope: "truth", storyFrom: null, storyUntil: null, readerOrder: null, objectId: "", sourceChapterId: "" };
  const facts = [];

  for (const entity of canon.entities) {
    const value = entityDescription(entity, labels);
    if (!value && !entity.aliases.length) continue;
    facts.push({
      ...base,
      id: derivedFactId("entity", entity.id),
      category: ENTITY_FACT_CATEGORY[entity.type],
      subjectId: entity.id,
      predicate: entityHeading(entity, labels),
      value: value.slice(0, 4000),
      strength: entity.type === "rule" ? "hard" : "soft",
      sourceRevision: entity.revision,
      derivedFrom: { kind: "entity", id: entity.id }
    });
  }

  for (const relation of canon.relations) {
    if (!names.has(relation.fromId) || !names.has(relation.toId)) continue;
    facts.push({
      ...base,
      id: derivedFactId("relation", relation.id),
      category: "relationship",
      subjectId: relation.fromId,
      objectId: relation.toId,
      predicate: `${names.get(relation.fromId)} → ${names.get(relation.toId)}`,
      value: relationDescription(relation, labels),
      storyFrom: relation.storyFrom,
      storyUntil: relation.storyUntil,
      sourceRevision: relation.revision,
      derivedFrom: { kind: "relation", id: relation.id }
    });
  }

  for (const event of canon.events) {
    if (!chapterOrder.has(event.chapterId)) continue;
    const participants = event.participantIds.map((item) => names.get(item)).filter(Boolean);
    facts.push({
      ...base,
      id: derivedFactId("event", event.id),
      category: "timeline",
      subjectId: "",
      predicate: event.title,
      value: [
        event.summary,
        event.timeLabel && `${labels.time}${labels.colon}${event.timeLabel}`,
        participants.length && `${labels.participants}${labels.colon}${participants.join(labels.listSeparator)}`,
        names.get(event.locationId) && `${labels.location}${labels.colon}${names.get(event.locationId)}`
      ].filter(Boolean).join(labels.separator).slice(0, 4000),
      readerOrder: chapterOrder.get(event.chapterId),
      sourceChapterId: event.chapterId,
      sourceRevision: event.revision,
      derivedFrom: { kind: "event", id: event.id }
    });
  }

  const anchorChapter = (anchor) => {
    if (!anchor) return "";
    return anchor.kind === "chapter" ? anchor.id : events.get(anchor.id)?.chapterId || "";
  };
  for (const setup of canon.setups) {
    const chapterId = anchorChapter(setup.plantedIn);
    if (setup.status === "dropped" || !chapterOrder.has(chapterId)) continue;
    facts.push({
      ...base,
      id: derivedFactId("setup", setup.id),
      category: "foreshadowing",
      subjectId: "",
      predicate: labels.setup,
      value: `${setup.description} (${setup.status === "paid" ? labels.setupPaid : labels.setupOpen})`,
      strength: "soft",
      status: setup.status === "paid" ? "resolved" : "active",
      readerOrder: chapterOrder.get(chapterId),
      sourceChapterId: chapterId,
      sourceRevision: setup.revision,
      derivedFrom: { kind: "setup", id: setup.id }
    });
  }

  return facts;
}

// Everything the consistency checks and the writing context select from:
// stored facts first, then the facts derived from structured objects.
function continuityFacts(work) {
  const stored = Array.isArray(work?.canon?.facts) ? work.canon.facts : [];
  return [...stored, ...deriveCanonFacts(work)];
}

// Ids of the derived facts whose text depends on the given object. An
// entity's name appears in the facts of its relations and of the events it
// takes part in or hosts, so those depend on it too; an event's chapter
// decides when a setup anchored to it becomes known.
function dependentDerivedFactIds(canonValue, collection, objectId) {
  const canon = normalizeCanonObjects(canonValue);
  const ids = new Set();
  const kind = DERIVED_KINDS[collection];
  if (kind) ids.add(derivedFactId(kind, objectId));
  if (collection === "entities") {
    for (const relation of canon.relations) {
      if (relation.fromId === objectId || relation.toId === objectId) ids.add(derivedFactId("relation", relation.id));
    }
    for (const event of canon.events) {
      if (event.participantIds.includes(objectId) || event.locationId === objectId) ids.add(derivedFactId("event", event.id));
    }
  }
  if (collection === "events") {
    for (const setup of canon.setups) {
      if ([setup.plantedIn, setup.paidOffIn].some((anchor) => anchor?.kind === "event" && anchor.id === objectId)) ids.add(derivedFactId("setup", setup.id));
    }
  }
  return [...ids];
}

// Ids of the derived facts whose reader order comes from a chapter: events
// told there, and setups anchored there or to such an event.
function chapterDerivedFactIds(canonValue, chapterIds) {
  const canon = normalizeCanonObjects(canonValue);
  const chapters = new Set(chapterIds);
  const ids = new Set();
  const eventIds = new Set();
  for (const event of canon.events) {
    if (!chapters.has(event.chapterId)) continue;
    eventIds.add(event.id);
    ids.add(derivedFactId("event", event.id));
  }
  for (const setup of canon.setups) {
    const anchored = [setup.plantedIn, setup.paidOffIn].some((anchor) => anchor && (anchor.kind === "chapter" ? chapters.has(anchor.id) : eventIds.has(anchor.id)));
    if (anchored) ids.add(derivedFactId("setup", setup.id));
  }
  return [...ids];
}

// The structured story data as short text for a prompt that has no
// continuity context of its own (the Ideate conversation). Free-text notes are
// not included; they are the writer's own working space.
function describeCanon(work, { limit = 2400 } = {}) {
  const canon = normalizeCanonObjects(work?.canon);
  const labels = promptLabels(work?.language);
  const names = new Map(canon.entities.map((entity) => [entity.id, entity.name]));
  const lines = [];
  for (const type of CARD_ENTITY_TYPES) {
    const entities = canon.entities.filter((entity) => entity.type === type);
    if (!entities.length) continue;
    lines.push(`${labels.groups[type]}${labels.colon.trim()}`);
    for (const entity of entities) {
      const description = entityDescription(entity, labels);
      lines.push(`- ${entityHeading(entity, labels)}${description ? `${labels.colon}${description}` : ""}`);
    }
  }
  const relations = canon.relations.filter((relation) => names.has(relation.fromId) && names.has(relation.toId));
  if (relations.length) {
    lines.push(`${labels.groups.relation}${labels.colon.trim()}`);
    for (const relation of relations) {
      lines.push(`- ${names.get(relation.fromId)} → ${names.get(relation.toId)}${labels.colon}${relationDescription(relation, labels)}`);
    }
  }
  const result = lines.join("\n");
  return result.length > limit ? `${result.slice(0, limit - 1)}…` : result;
}

module.exports = {
  CANON_COLLECTIONS,
  CARD_ENTITY_TYPES,
  CARD_FIELDS,
  ENTITY_TYPES,
  LIMITS,
  RELATION_KINDS,
  SETUP_ANCHOR_KINDS,
  SETUP_STATUSES,
  chapterDerivedFactIds,
  continuityFacts,
  dependentDerivedFactIds,
  derivedFactId,
  deriveCanonFacts,
  describeCanon,
  isDerivedFactId,
  normalizeCanonObject,
  normalizeCanonObjects,
  normalizeEntity,
  normalizeEvent,
  normalizeRelation,
  normalizeSetup,
  normalizeThread,
  repairCanonReferences
};
