"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { createId, nowIso } = require("./domain");
const { appError } = require("./errors");
const { normalizeRichContent, plainTextToRichContent, richContentToMarkdown } = require("./studio");
const clone = (x) => structuredClone(x);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function fail(code, params) { throw appError(code, params); }
function ensureVersion(actual, expected) {
  if (!Number.isInteger(expected)) fail("BASE_REVISION_REQUIRED");
  if (actual !== expected) fail("REVISION_CONFLICT");
}
function deltaLength(delta) { return (delta?.ops || []).reduce((n, op) => n + (typeof op.insert === "string" ? op.insert.length : 1), 0); }
function normalizeScene(value = {}, length = 1) {
  const text = (key, max = 4000) => String(value[key] || "").trim().slice(0, max);
  return {
    id: value.id || createId("scene"), title: text("title", 100) || "新场景",
    status: ["planned", "draft", "done"].includes(value.status) ? value.status : "planned",
    targetCharacters: Math.max(200, Math.min(2000, Number(value.targetCharacters) || 800)),
    povId: text("povId", 120), participants: text("participants"), location: text("location"),
    storyTime: Number.isFinite(value.storyTime) ? value.storyTime : null,
    timeLabel: text("timeLabel", 240), flashback: Boolean(value.flashback),
    goal: text("goal"), conflict: text("conflict"), must: text("must"), mustNot: text("mustNot"), ending: text("ending"),
    start: Math.max(0, Math.min(length - 1, Number(value.start) || 0)),
    end: Math.max(0, Math.min(length - 1, Number(value.end) || 0)),
    needsRelocation: Boolean(value.needsRelocation)
  };
}
// Defaults of one story. Storage works story by story (see src/storage.js), so
// everything a story needs is set here, not on the database as a whole.
function upgradeWork(work, version = 5) {
  work.structureRevision ||= 1; work.canonRevision ||= 1;
  work.volumes ||= []; work.deletedChapters ||= []; work.writingPreferences ||= {};
  for (const chapter of [...(work.chapters || []), ...work.deletedChapters]) {
    chapter.revision ||= 1; chapter.revisions ||= []; chapter.volumeId ||= "";
    chapter.richContent ||= plainTextToRichContent(chapter.content || "");
    if (version >= 4) chapter.scenes ||= [normalizeScene({ title: chapter.title || "默认场景", end: deltaLength(chapter.richContent) - 1 }, deltaLength(chapter.richContent))];
  }
  return work;
}
function upgradeWorkspace(db, version = 5) {
  db.tasks ||= []; db.usage ||= []; db.imports ||= []; db.receipts ||= [];
  db.settings ||= { dailyTokenLimit: 200000 };
  for (const work of db.works) upgradeWork(work, version);
  return db;
}
function bumpVersions(previous, next) {
  upgradeWorkspace(next);
  for (const work of next.works) {
    const old = previous.works.find(w => w.id === work.id);
    if (old) bumpWorkVersions(old, work);
  }
}
// Moves the revisions of one story by comparing it with its stored version.
function bumpWorkVersions(old, work) {
    const structure = w => ({ title: w.title, premise: w.premise, genre: w.genre, notes: w.notes, volumes: w.volumes, prefs: w.writingPreferences, target: w.targetCharacters, chapters: w.chapters.map(c => ({ id: c.id, title: c.title, volumeId: c.volumeId, scenes: c.scenes })) });
    work.structureRevision = (old.structureRevision || 1) + (same(structure(old), structure(work)) ? 0 : 1);
    work.canonRevision = (old.canonRevision || 1) + (same([old.canon, old.storyBible], [work.canon, work.storyBible]) ? 0 : 1);
    for (const chapter of work.chapters) {
      const before = old.chapters.find(c => c.id === chapter.id);
      if (!before) continue;
      const changed = !same(before.richContent, chapter.richContent) || before.content !== chapter.content;
      chapter.revision = (before.revision || 1) + Number(changed);
      if (changed && chapter.chapterMemory?.sourceContentHash !== crypto.createHash("sha256").update(String(chapter.content || "").replace(/\r\n?/g, "\n")).digest("hex")) {
        if (chapter.chapterMemory) chapter.chapterMemory.status = "stale";
      }
    }
}
// Slice Delta operations without flattening formatting or embedded objects.
function sliceDelta(delta, start, end) {
  const ops = []; let offset = 0;
  for (const op of delta.ops || []) {
    const length = typeof op.insert === "string" ? op.insert.length : 1;
    if (offset < end && offset + length > start) {
      if (typeof op.insert !== "string") fail("RANGE_CONTAINS_IMAGE");
      ops.push({ ...op, insert: op.insert.slice(Math.max(0, start - offset), Math.min(length, end - offset)) });
    }
    offset += length;
  }
  return ops;
}
function slicePreservingEmbeds(delta, start, end) {
  const ops = []; let offset = 0;
  for (const op of delta.ops || []) {
    const length = typeof op.insert === "string" ? op.insert.length : 1;
    if (offset < end && offset + length > start) ops.push(typeof op.insert === "string" ? { ...op, insert: op.insert.slice(Math.max(0, start - offset), Math.min(length, end - offset)) } : clone(op));
    offset += length;
  }
  return ops;
}
function replaceRange(delta, range, text) {
  const size = deltaLength(delta);
  if (!Number.isInteger(range.index) || !Number.isInteger(range.length) || range.index < 0 || range.length < 0 || range.index + range.length > size - 1) fail("RANGE_INVALID");
  sliceDelta(delta, range.index, range.index + range.length);
  return normalizeRichContent({ ops: [...slicePreservingEmbeds(delta, 0, range.index), ...(text ? [{ insert: text }] : []), ...slicePreservingEmbeds(delta, range.index + range.length, size)] });
}
function transformScenes(chapter, before, after) {
  if (same(before, after)) return;
  const flatten = d => (d.ops || []).map(op => typeof op.insert === "string" ? op.insert : "\ufffc").join("");
  const a = flatten(before), b = flatten(after);
  let start = 0; while (start < Math.min(a.length, b.length) && a[start] === b[start]) start++;
  let suffix = 0; while (suffix < a.length - start && suffix < b.length - start && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const end = a.length - suffix, shift = b.length - a.length;
  for (const scene of chapter.scenes || []) {
    if (scene.end < start) continue;
    if (scene.start > end) { scene.start += shift; scene.end += shift; }
    else if (scene.start <= start && scene.end >= end) scene.end += shift;
    else { scene.needsRelocation = true; scene.start = Math.min(scene.start, b.length - 1); scene.end = Math.min(scene.end, b.length - 1); }
  }
}
function makeHunks(chapter, range, output) {
  const original = sliceDelta(chapter.richContent, range.index, range.index + range.length).map(op => op.insert).join("");
  const oldParts = original.match(/[^\n]*(?:\n|$)/g)?.filter(Boolean) || [];
  const newParts = String(output).match(/[^\n]*(?:\n|$)/g)?.filter(Boolean) || [];
  if (!range.length) return newParts.map((text, index) => ({ id: `h${index}`, index: range.index, length: 0, before: "", after: text }));
  // Different paragraph counts are one atomic replacement; never guess alignment.
  if (oldParts.length !== newParts.length) return [{ id: "h0", ...range, before: original, after: output }];
  let offset = range.index;
  return oldParts.map((text, index) => { const h = { id: `h${index}`, index: offset, length: text.length, before: text, after: newParts[index] }; offset += text.length; return h; }).filter(h => h.before !== h.after);
}
function mergeHunks(chapter, hunks, ids) {
  if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length || ids.some(id => !hunks.some(h => h.id === id))) fail("HUNKS_INVALID");
  let delta = chapter.richContent;
  const chosen = hunks.filter(h => ids.includes(h.id));
  for (const h of [...chosen].reverse()) delta = replaceRange(delta, h, h.after);
  return delta;
}
function createWorkspaceService(store, directory) {
  const historyDir = path.join(directory, "history");
  async function snapshot(work, chapter, source, name = "") {
    const last = chapter.revisions?.at(-1);
    if (source === "auto" && last && Date.now() - Date.parse(last.createdAt) < 300000) return null;
    const value = { ...clone(chapter), revisions: undefined };
    const hash = crypto.createHash("sha256").update(JSON.stringify(value.richContent)).digest("hex");
    if (source === "auto" && last?.hash === hash) return null;
    const id = createId("revision"); await fs.mkdir(historyDir, { recursive: true });
    const temp = path.join(historyDir, `${id}.tmp`), target = path.join(historyDir, `${id}.json`);
    await fs.writeFile(temp, JSON.stringify({ workId: work.id, chapter: value }), { flag: "wx" }); await fs.rename(temp, target);
    const meta = { id, chapterId: chapter.id, createdAt: nowIso(), source, name: String(name).slice(0, 100), hash, characters: richContentToMarkdown(chapter.richContent).replace(/\s/g, "").length };
    (chapter.revisions ||= []).push(meta); return meta;
  }
  async function readSnapshot(work, chapter, id) {
    if (!chapter.revisions?.some(r => r.id === id)) fail("REVISION_NOT_FOUND");
    const result = JSON.parse(await fs.readFile(path.join(historyDir, `${id}.json`), "utf8"));
    if (result.workId !== work.id || result.chapter.id !== chapter.id) fail("REVISION_MISMATCH");
    return result.chapter;
  }
  async function mutate(workId, chapterId, baseRevision, fn) {
    return store.transactWork(workId, async work => {
      upgradeWork(work);
      const chapter = chapterId ? work.chapters.find(c => c.id === chapterId) : null;
      if (chapterId && !chapter) fail("CHAPTER_NOT_FOUND");
      ensureVersion(chapter ? chapter.revision : work.structureRevision, baseRevision);
      const result = await fn(work, chapter);
      work.updatedAt = nowIso();
      if (chapter) chapter.updatedAt = nowIso();
      return result || { work, chapter };
    });
  }
  return { snapshot, readSnapshot, mutate, historyDir };
}
module.exports = { upgradeWork, upgradeWorkspace, bumpVersions, bumpWorkVersions, createWorkspaceService, normalizeScene, ensureVersion, transformScenes, deltaLength, makeHunks, mergeHunks, replaceRange, fail };
