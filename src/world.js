"use strict";
const { appError } = require("./errors");

// The world in a sentence (plan 5.6): "A world where ___, in which ___" /
// "一个____的世界，在这里____". Kept on the story as `work.world`; a missing
// one reads as empty. Rules, places and factions are cards (`work.canon`).

const WORLD_FIELDS = ["what", "here"];
const MAX_FIELD = 500;

const clean = (value) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, MAX_FIELD) : "");

function normalizeWorld(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    what: clean(source.what),
    here: clean(source.here),
    revision: Number.isInteger(source.revision) && source.revision > 0 ? source.revision : 0,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : ""
  };
}

/** Saves the sentence against the revision it was read at; only the parts sent change. */
function updateWorld(work, body, now) {
  const current = normalizeWorld(work.world);
  if (!body || typeof body !== "object" || !body.lines || typeof body.lines !== "object") throw appError("BAD_REQUEST");
  if (body.baseRevision !== current.revision) throw appError("REVISION_CONFLICT");
  const changes = Object.fromEntries(WORLD_FIELDS.filter((key) => body.lines[key] !== undefined).map((key) => [key, body.lines[key]]));
  const next = normalizeWorld({ ...current, ...changes });
  next.revision = current.revision + 1;
  next.updatedAt = now;
  work.world = next;
  return next;
}

module.exports = { normalizeWorld, updateWorld };
