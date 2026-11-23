"use strict";
const { createId, nowIso } = require("./domain");
const { appError } = require("./errors");
const { assertOwner } = require("./auth");
const { normalizeCanon } = require("./continuity");
const { invalidateDependencies } = require("./temporal");
const {
  CANON_COLLECTIONS, CARD_ENTITY_TYPES, CARD_FIELDS, RELATION_KINDS, SETUP_ANCHOR_KINDS, SETUP_STATUSES,
  dependentDerivedFactIds, normalizeCanonObject, normalizeCanonObjects, repairCanonReferences
} = require("./canon-model");

// Reads and writes of the structured story objects (data model v6). Everything
// goes through the storage layer's transactions; this module never touches
// files. Each object carries its own `revision`: a change must name the
// revision it was made against, so two windows cannot overwrite each other.
// Any change also moves `work.canonRevision` (see `bumpVersions`), which is
// what generations, reviews and fact proposals are checked against.

const ID_PREFIX = Object.freeze({ entities: "entity", relations: "relation", events: "event", threads: "thread", setups: "setup" });

// Reasons recorded on invalidated facts, chapter memories and generations.
// Codes, not prose: the interface decides how to word them.
const REASON_CHANGED = "canon_object_changed";
const REASON_REMOVED = "canon_object_removed";

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function stringField(body, key) {
  if (typeof body[key] !== "string") throw appError("BAD_REQUEST");
  return body[key];
}

function storyTimeField(body, key) {
  const value = body[key];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw appError("BAD_REQUEST");
  return value;
}

function idArrayField(body, key) {
  const value = body[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw appError("BAD_REQUEST");
  return value;
}

// Each reader copies the fields the request names onto `next` and rejects
// values of the wrong shape. References are checked afterwards, against the
// story as it is inside the transaction.
const READERS = {
  entities(body, next, { creating }) {
    if (creating) {
      if (!CARD_ENTITY_TYPES.includes(body.type)) throw appError("CANON_ENTITY_TYPE_UNSUPPORTED");
      next.type = body.type;
    } else if (has(body, "type") && body.type !== next.type) {
      // A card's questions belong to its type; changing type would silently
      // drop answers. Create a new card instead.
      throw appError("CANON_ENTITY_TYPE_UNSUPPORTED");
    }
    for (const key of ["name", "summary", "notes", "image", "color"]) if (has(body, key)) next[key] = stringField(body, key);
    if (has(body, "aliases")) next.aliases = idArrayField(body, "aliases");
    if (has(body, "parentId")) next.parentId = stringField(body, "parentId");
    if (has(body, "card")) {
      if (!isObject(body.card)) throw appError("BAD_REQUEST");
      const card = { ...next.card };
      for (const key of CARD_FIELDS[next.type]) if (has(body.card, key)) card[key] = stringField(body.card, key);
      next.card = card;
    }
  },
  relations(body, next) {
    for (const key of ["fromId", "toId", "label", "tension", "fromChapterId", "untilChapterId"]) if (has(body, key)) next[key] = stringField(body, key);
    if (has(body, "kind")) {
      if (!RELATION_KINDS.includes(body.kind)) throw appError("BAD_REQUEST");
      next.kind = body.kind;
    }
    for (const key of ["storyFrom", "storyUntil"]) if (has(body, key)) next[key] = storyTimeField(body, key);
  },
  events(body, next) {
    for (const key of ["title", "summary", "timeLabel", "chapterId", "locationId"]) if (has(body, key)) next[key] = stringField(body, key);
    for (const key of ["participantIds", "threadIds"]) if (has(body, key)) next[key] = idArrayField(body, key);
    if (has(body, "storyOrder")) {
      if (!Number.isSafeInteger(body.storyOrder)) throw appError("BAD_REQUEST");
      next.storyOrder = body.storyOrder;
    }
  },
  threads(body, next) {
    for (const key of ["name", "color"]) if (has(body, key)) next[key] = stringField(body, key);
  },
  setups(body, next) {
    if (has(body, "description")) next.description = stringField(body, "description");
    if (has(body, "status")) {
      if (!SETUP_STATUSES.includes(body.status)) throw appError("BAD_REQUEST");
      next.status = body.status;
    }
    for (const key of ["plantedIn", "paidOffIn"]) {
      if (!has(body, key)) continue;
      const anchor = body[key];
      if (anchor !== null && !(isObject(anchor) && SETUP_ANCHOR_KINDS.includes(anchor.kind) && typeof anchor.id === "string")) throw appError("BAD_REQUEST");
      next[key] = anchor;
    }
  }
};

function checkReferences(collection, item, work) {
  const canon = work.canon;
  const entity = (id) => canon.entities.find((candidate) => candidate.id === id);
  const missing = (field) => appError("CANON_REFERENCE_NOT_FOUND", { field });
  if (collection === "entities" || collection === "threads") {
    if (!item.name) throw appError("CANON_NAME_REQUIRED");
  }
  if (collection === "entities" && item.parentId) {
    if (entity(item.parentId)?.type !== "location") throw missing("parentId");
    // Walking up from the new parent must never reach the place itself.
    const seen = new Set();
    for (let at = item.parentId; at; at = entity(at)?.parentId || "") {
      if (at === item.id || seen.has(at)) throw appError("CANON_PLACE_CYCLE");
      seen.add(at);
    }
  }
  if (collection === "relations") {
    if (!entity(item.fromId)) throw missing("fromId");
    if (!entity(item.toId)) throw missing("toId");
    if (item.fromId === item.toId) throw appError("CANON_RELATION_SELF");
    if (item.storyFrom !== null && item.storyUntil !== null && item.storyUntil <= item.storyFrom) throw appError("CANON_STORY_RANGE_INVALID");
    const chapterAt = (chapterId) => work.chapters.findIndex((chapter) => chapter.id === chapterId);
    if (item.fromChapterId && chapterAt(item.fromChapterId) < 0) throw missing("fromChapterId");
    if (item.untilChapterId && chapterAt(item.untilChapterId) < 0) throw missing("untilChapterId");
    if (item.fromChapterId && item.untilChapterId && chapterAt(item.untilChapterId) < chapterAt(item.fromChapterId)) throw appError("CANON_STORY_RANGE_INVALID");
  }
  if (collection === "events") {
    if (!item.title) throw appError("CANON_NAME_REQUIRED");
    if (item.chapterId && !work.chapters.some((chapter) => chapter.id === item.chapterId)) throw missing("chapterId");
    if (item.participantIds.some((id) => !entity(id))) throw missing("participantIds");
    if (item.locationId && entity(item.locationId)?.type !== "location") throw missing("locationId");
    if (item.threadIds.some((id) => !canon.threads.some((thread) => thread.id === id))) throw missing("threadIds");
  }
  if (collection === "setups") {
    if (!item.description) throw appError("CANON_NAME_REQUIRED");
    for (const key of ["plantedIn", "paidOffIn"]) {
      const anchor = item[key];
      if (!anchor) continue;
      const pool = anchor.kind === "chapter" ? work.chapters : canon.events;
      if (!pool.some((candidate) => candidate.id === anchor.id)) throw missing(key);
    }
  }
}

function publicCanon(work) {
  const objects = normalizeCanonObjects(work.canon);
  return { ...objects, canonRevision: work.canonRevision };
}

function createCanonRepository(store, { now = nowIso, makeId = createId } = {}) {
  function collectionOf(name) {
    if (!CANON_COLLECTIONS.includes(name)) throw appError("ROUTE_NOT_FOUND");
    return name;
  }

  async function mutate(workId, user, fn) {
    if (!user) throw appError("AUTH_REQUIRED");
    let work;
    const result = await store.transactWork(workId, (stored) => {
      work = stored;
      assertOwner(user, work);
      work.chapters ||= [];
      work.canon = normalizeCanon(work.canon);
      const value = fn(work);
      work.updatedAt = now();
      return value;
    });
    // `canonRevision` is moved by the storage layer when the transaction ends.
    return { ...result, canonRevision: work.canonRevision };
  }

  async function read(workId, user) {
    if (!user) throw appError("AUTH_REQUIRED");
    const work = await store.getWork(workId);
    if (!work) throw appError("WORK_NOT_FOUND");
    assertOwner(user, work);
    return publicCanon(work);
  }

  async function create(workId, user, collectionName, body) {
    const collection = collectionOf(collectionName);
    if (!isObject(body)) throw appError("BAD_REQUEST");
    return mutate(workId, user, (work) => {
      const timestamp = now();
      const next = { id: makeId(ID_PREFIX[collection]), ownerId: user.id, revision: 1, createdAt: timestamp, updatedAt: timestamp };
      if (collection === "entities") next.card = {};
      if (collection === "events") next.storyOrder = work.canon.events.reduce((highest, event) => Math.max(highest, event.storyOrder), 0) + 1;
      READERS[collection](body, next, { creating: true });
      const normalized = normalizeCanonObject(collection, next);
      checkReferences(collection, normalized, work);
      work.canon[collection].push(normalized);
      return { item: normalized, impacts: { chapterIds: [], factIds: [], generationRecordIds: [] } };
    });
  }

  async function update(workId, user, collectionName, itemId, body) {
    const collection = collectionOf(collectionName);
    if (!isObject(body)) throw appError("BAD_REQUEST");
    return mutate(workId, user, (work) => {
      const index = work.canon[collection].findIndex((candidate) => candidate.id === itemId);
      if (index < 0) throw appError("CANON_ITEM_NOT_FOUND");
      const before = work.canon[collection][index];
      if (!Number.isInteger(body.baseRevision)) throw appError("BASE_REVISION_REQUIRED");
      if (body.baseRevision !== before.revision) throw appError("REVISION_CONFLICT");
      const next = structuredClone(before);
      READERS[collection](body, next, { creating: false });
      const normalized = normalizeCanonObject(collection, next);
      checkReferences(collection, normalized, work);
      if (JSON.stringify(normalized) === JSON.stringify(before)) {
        return { item: before, impacts: { chapterIds: [], factIds: [], generationRecordIds: [] } };
      }
      // What depended on the old version: its own derived fact, and (when an
      // entity is renamed) the facts that spell out its name.
      const renamed = collection === "entities" && normalized.name !== before.name;
      const retold = collection === "events" && normalized.chapterId !== before.chapterId;
      const narrow = (collection === "entities" && !renamed) || (collection === "events" && !retold);
      const dependents = dependentDerivedFactIds(narrow ? { [collection]: [before] } : work.canon, collection, itemId);
      normalized.revision = before.revision + 1;
      normalized.updatedAt = now();
      work.canon[collection][index] = normalized;
      const impacts = invalidateDependencies(work, { factIds: dependents, reason: REASON_CHANGED });
      return { item: normalized, impacts };
    });
  }

  async function remove(workId, user, collectionName, itemId, body) {
    const collection = collectionOf(collectionName);
    return mutate(workId, user, (work) => {
      const before = work.canon[collection].find((candidate) => candidate.id === itemId);
      if (!before) throw appError("CANON_ITEM_NOT_FOUND");
      if (!Number.isInteger(body?.baseRevision)) throw appError("BASE_REVISION_REQUIRED");
      if (body.baseRevision !== before.revision) throw appError("REVISION_CONFLICT");
      const dependents = dependentDerivedFactIds(work.canon, collection, itemId);
      // Stored facts about a removed entity can no longer be trusted as they
      // stand; they wait for the writer's review instead of being deleted.
      const orphaned = collection === "entities"
        ? work.canon.facts.filter((fact) => fact.subjectId === itemId || fact.objectId === itemId).map((fact) => fact.id)
        : [];
      // Places inside a removed place move up one level.
      if (collection === "entities" && before.type === "location") {
        for (const child of work.canon.entities) {
          if (child.parentId !== itemId) continue;
          child.parentId = before.parentId || "";
          child.revision += 1;
        }
      }
      work.canon[collection] = work.canon[collection].filter((candidate) => candidate.id !== itemId);
      const relationsBefore = work.canon.relations.map((relation) => relation.id);
      repairCanonReferences(work.canon);
      const removedRelationIds = relationsBefore.filter((id) => !work.canon.relations.some((relation) => relation.id === id));
      const impacts = invalidateDependencies(work, { factIds: [...dependents, ...orphaned], reason: REASON_REMOVED });
      return { removed: { id: itemId, relationIds: removedRelationIds }, impacts };
    });
  }

  // Puts the events in a new story order (the "as it happened" order of the
  // Timeline). Names every event once, and the canon revision it was based on.
  async function reorderEvents(workId, user, body) {
    if (!isObject(body) || !Array.isArray(body.eventIds)) throw appError("BAD_REQUEST");
    if (!Number.isInteger(body.canonRevision)) throw appError("BASE_REVISION_REQUIRED");
    return mutate(workId, user, (work) => {
      if (body.canonRevision !== work.canonRevision) throw appError("REVISION_CONFLICT");
      const events = work.canon.events;
      const ids = body.eventIds;
      if (ids.length !== events.length || new Set(ids).size !== ids.length || ids.some((id) => !events.some((event) => event.id === id))) {
        throw appError("EVENT_ORDER_INVALID");
      }
      const timestamp = now();
      ids.forEach((id, index) => {
        const event = events.find((candidate) => candidate.id === id);
        if (event.storyOrder === index + 1) return;
        event.storyOrder = index + 1;
        event.revision += 1;
        event.updatedAt = timestamp;
      });
      // Story order is not part of any derived fact, so nothing else is invalidated.
      return { events: [...events].sort((a, b) => a.storyOrder - b.storyOrder) };
    });
  }

  return { read, create, update, remove, reorderEvents };
}

module.exports = { createCanonRepository, REASON_CHANGED, REASON_REMOVED };
