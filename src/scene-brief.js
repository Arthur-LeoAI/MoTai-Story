"use strict";
const { derivedFactId, deriveCanonFacts, normalizeCanonObjects } = require("./canon-model");

// The scene brief (plan 5.9 B): before writing a chapter, what the assistant
// will keep in mind for it. Worked out from the chapter's plan, its scenes and
// text, and the structured story data; no AI involved. Every item that stands
// for a derived fact can be unticked by the writer (`chapter.briefExcluded`),
// and the writing context then leaves that fact out. Rules cannot be
// unticked: they are hard constraints of the story, which the consistency
// checks protect.

const MAX_EXCLUDED = 500;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  return typeof value === "string" ? value : "";
}

// Everything in the chapter a name could appear in: the plan, the scenes and the text.
function chapterText(chapter) {
  const planning = isObject(chapter.planning) ? chapter.planning : {};
  const scenes = Array.isArray(chapter.scenes) ? chapter.scenes : [];
  return [
    ...["goal", "scene", "characters", "conflict", "hook"].map((key) => text(planning[key])),
    ...scenes.flatMap((scene) => ["title", "participants", "location", "goal", "conflict", "must", "ending", "povId"].map((key) => text(scene?.[key]))),
    text(chapter.content)
  ].join("\n");
}

function mentions(haystack, names, english) {
  return names.filter(Boolean).some((name) => {
    if (!english) return haystack.includes(name);
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "iu").test(haystack);
  });
}

/** What the chapter should achieve, from its plan or else its scenes. */
function chapterGoal(chapter) {
  const planned = text(chapter.planning?.goal).trim();
  if (planned) return { text: planned, source: "planning" };
  const scenes = (Array.isArray(chapter.scenes) ? chapter.scenes : []).map((scene) => text(scene?.goal).trim()).filter(Boolean);
  return scenes.length ? { text: scenes.join("\n"), source: "scenes" } : { text: "", source: "" };
}

function normalizeExcluded(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => typeof item === "string" && item.length <= 160 && /^[\w:-]+$/.test(item)))].slice(0, MAX_EXCLUDED);
}

function buildSceneBrief(work, chapterId) {
  const chapters = Array.isArray(work?.chapters) ? work.chapters : [];
  const order = chapters.findIndex((chapter) => chapter.id === chapterId);
  const chapter = chapters[order];
  if (!chapter) return null;
  const english = work.language === "en";
  const canon = normalizeCanonObjects(work.canon);
  const facts = new Map(deriveCanonFacts(work).map((fact) => [fact.id, fact]));
  const haystack = chapterText(chapter);
  const entities = new Map(canon.entities.map((entity) => [entity.id, entity]));
  const toldHere = canon.events.filter((event) => event.chapterId === chapter.id);
  const chapterIndex = new Map(chapters.map((item, index) => [item.id, index]));

  const item = (factId, label, detail, reason, extra = {}) => ({
    factId: facts.has(factId) ? factId : "",
    label,
    detail,
    reason,
    excludable: facts.has(factId) && facts.get(factId).strength !== "hard",
    ...extra
  });

  const reasonFor = (entity) => {
    if (mentions(haystack, [entity.name, ...entity.aliases], english)) return "named";
    return toldHere.some((event) => event.participantIds.includes(entity.id) || event.locationId === entity.id) ? "event" : "";
  };

  const people = canon.entities
    .filter((entity) => entity.type === "character")
    .map((entity) => ({ entity, reason: reasonFor(entity) }))
    .filter(({ reason }) => reason)
    .map(({ entity, reason }) => item(derivedFactId("entity", entity.id), entity.name, entity.summary, reason, { entityId: entity.id }));
  const present = new Set(people.map((person) => person.entityId));

  const places = canon.entities
    .filter((entity) => entity.type === "location")
    .map((entity) => ({ entity, reason: reasonFor(entity) }))
    .filter(({ reason }) => reason)
    .map(({ entity, reason }) => item(derivedFactId("entity", entity.id), entity.name, entity.summary, reason, { entityId: entity.id }));

  const relations = canon.relations
    .filter((relation) => present.has(relation.fromId) && present.has(relation.toId))
    .map((relation) => {
      const fact = facts.get(derivedFactId("relation", relation.id));
      return item(derivedFactId("relation", relation.id), fact?.predicate || `${entities.get(relation.fromId)?.name} → ${entities.get(relation.toId)?.name}`, fact?.value || "", "between", { relationId: relation.id });
    });

  const rules = canon.entities
    .filter((entity) => entity.type === "rule")
    .map((entity) => item(derivedFactId("entity", entity.id), entity.name, facts.get(derivedFactId("entity", entity.id))?.value || entity.summary, "always", { entityId: entity.id }));

  // Threads: what happens here, setups still open by now, and setups paid off here.
  const anchorIndex = (anchor) => {
    if (!anchor) return -1;
    const id = anchor.kind === "chapter" ? anchor.id : canon.events.find((event) => event.id === anchor.id)?.chapterId;
    return chapterIndex.has(id) ? chapterIndex.get(id) : -1;
  };
  const threads = [
    ...toldHere.map((event) => item(derivedFactId("event", event.id), event.title, event.summary, "happens", { eventId: event.id })),
    ...canon.setups
      .filter((setup) => setup.status === "open" && anchorIndex(setup.plantedIn) >= 0 && anchorIndex(setup.plantedIn) <= order)
      .map((setup) => item(derivedFactId("setup", setup.id), setup.description, "", anchorIndex(setup.paidOffIn) === order ? "payoff" : "open", { setupId: setup.id }))
  ];

  // Every other card is also given to the assistant; listed so the brief shows
  // all of it, and so it can be left out too.
  const shown = new Set([...people, ...places, ...rules].map((entry) => entry.entityId));
  const others = canon.entities
    .filter((entity) => !shown.has(entity.id) && facts.has(derivedFactId("entity", entity.id)))
    .map((entity) => item(derivedFactId("entity", entity.id), entity.name, entity.summary, "elsewhere", { entityId: entity.id, type: entity.type }));

  const sections = [
    { key: "people", items: people },
    { key: "places", items: places },
    { key: "relations", items: relations },
    { key: "rules", items: rules },
    { key: "threads", items: threads },
    { key: "others", items: others }
  ];
  const ids = new Set(sections.flatMap((section) => section.items.map((entry) => entry.factId)).filter(Boolean));
  return {
    chapterId: chapter.id,
    goal: chapterGoal(chapter),
    sections,
    excluded: normalizeExcluded(chapter.briefExcluded).filter((id) => ids.has(id))
  };
}

module.exports = { buildSceneBrief, normalizeExcluded };
