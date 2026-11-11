"use strict";
const { createId, nowIso } = require("./domain");
const { plainTextToRichContent, normalizeRichContent, richContentToMarkdown } = require("./studio");
const { upgradeWorkspace, normalizeScene, ensureVersion, transformScenes, deltaLength, mergeHunks, fail } = require("./workspace");
const { invalidateDependencies, normalizeTemporalFact, adjudicateConflict } = require("./temporal");
function createBetaApi({ store, service, tasks, readDb, readBody, sendJson, analyze, canAccept, hash, normalizeMemory, selectContext }) {
  const result = (res, value, status = 200) => { sendJson(res, status, value); return true; };
  return async function handle(req, res, url) {
    const p = url.pathname.split("/").filter(Boolean);
    if (p[0] !== "api") return false;
    if (p[1] === "tasks") {
      await readDb();
      if (req.method === "POST" && p.length === 2) {
        const body = await readBody(req); const db = await store.read();
        const work = db.works.find(w => w.id === body.workId), chapter = work?.chapters.find(c => c.id === body.chapterId);
        if (!chapter) fail("CHAPTER_NOT_FOUND"); ensureVersion(chapter.revision, body.baseRevision);
        return result(res, { task: await tasks.create(body) }, 202);
      }
      if (req.method === "POST" && p[3] === "cancel") return result(res, { task: await tasks.cancel(p[2]) });
      if (req.method === "GET" && p[3] === "events") {
        if (!await tasks.get(p[2])) fail("TASK_NOT_FOUND");
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
        let closed = false, last = ""; res.on("close", () => { closed = true; });
        while (!closed) {
          const task = await tasks.get(p[2]); const serialized = JSON.stringify(task);
          if (serialized !== last) { res.write(`event: task\ndata: ${serialized}\n\n`); last = serialized; }
          if (["completed", "failed", "cancelled", "interrupted"].includes(task.status)) break;
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        res.end(); return true;
      }
      if (req.method === "GET") return result(res, p[2] ? { task: await tasks.get(p[2]) } : { tasks: await tasks.list(url.searchParams.get("workId")) });
    }
    if (p[1] === "usage" && req.method === "GET") {
      const db = await readDb(); const entries = db.usage.filter(u => !url.searchParams.get("workId") || u.workId === url.searchParams.get("workId"));
      return result(res, { entries, dailyTokenLimit: db.settings.dailyTokenLimit, totalTokens: entries.reduce((n, u) => n + (u.totalTokens || 0), 0), unknownCalls: entries.filter(u => u.totalTokens === undefined).length });
    }
    if (p[1] === "imports" && req.method === "POST") {
      const body = await readBody(req, 30 * 1024 * 1024); await readDb();
      const { parseManuscript } = require("./manuscript-import");
      if (p.length === 2) {
        const parsed = await parseManuscript(body);
        const preview = { ...parsed, id: createId("import"), createdAt: nowIso() };
        await store.transact(db => { db.imports.push(preview); });
        return result(res, { preview });
      }
      if (p[3] === "confirm") {
        const saved = await store.transact(async db => {
          const preview = db.imports.find(i => i.id === p[2]); if (!preview) fail("IMPORT_PREVIEW_NOT_FOUND");
          if (preview.workId) return { work: db.works.find(w => w.id === preview.workId) };
          const chapters = body.chapters || preview.chapters.map((chapter, sourceIndex) => ({ ...chapter, sourceIndex }));
          if (!Array.isArray(chapters) || !chapters.length || chapters.length > 10000) fail("IMPORT_CHAPTERS_INVALID");
          if (chapters.reduce((n, c) => n + String(c.content || "").length, 0) > 1000000) fail("IMPORT_TEXT_TOO_LARGE");
          const timestamp = nowIso();
          const work = { id: createId("work"), ownerId: "local", title: String(body.title || preview.title || "导入作品").slice(0, 100), genre: "原创", premise: "", createdAt: timestamp, updatedAt: timestamp, storyBible: {}, canon: { entities: [], facts: [] }, generationRecords: [], canonProposals: [], chapters: chapters.map(c => {
            // Only reuse the server-parsed Delta. Titles are editable and not unique;
            // neither a title lookup nor a client-supplied Delta establishes provenance.
            const original = Number.isInteger(c.sourceIndex) ? preview.chapters[c.sourceIndex] : null;
            const delta = original?.richContent && c.content === original.content ? normalizeRichContent(original.richContent) : plainTextToRichContent(String(c.content || ""));
            return { id: createId("chapter"), title: String(c.title || "未命名章节").slice(0, 100), richContent: delta, content: richContentToMarkdown(delta), createdAt: timestamp, updatedAt: timestamp, status: "draft" };
          }) };
          db.works.push(work); upgradeWorkspace(db);
          for (const chapter of work.chapters) await service.snapshot(work, chapter, "import");
          preview.workId = work.id; return { work };
        }); return result(res, saved, 201);
      }
    }
    if (p[1] !== "works" || !p[2]) return false;
    const db = await readDb(), work = db.works.find(w => w.id === p[2]);
    if (!work) return false;
    if (p[3] === "export" && req.method === "GET" && url.searchParams.get("format") === "docx") {
      const { createDocx } = require("./manuscript-import"); const buffer = await createDocx(work);
      res.writeHead(200, { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(work.title + ".docx")}` }); res.end(buffer); return true;
    }
    if (p[3] === "search" && req.method === "GET") {
      const q = (url.searchParams.get("q") || "").trim().slice(0, 200);
      const hits = q ? work.chapters.flatMap(c => { const text = c.content || "", at = text.indexOf(q); return at >= 0 || c.title.includes(q) ? [{ chapterId: c.id, title: c.title, excerpt: text.slice(Math.max(0, at - 60), at + 180) }] : []; }) : [];
      return result(res, { hits, entities: work.canon.entities.filter(e => q && [e.name, ...(e.aliases || [])].some(v => v.includes(q))) });
    }
    if (p[3] === "preferences" && req.method === "PATCH") {
      const body = await readBody(req);
      return result(res, await service.mutate(work.id, null, body.baseRevision, w => { w.writingPreferences = Object.fromEntries(["person", "viewpoint", "dialogue", "bannedWords", "avoid", "samples"].map(k => [k, String(body[k] || "").slice(0, k === "samples" ? 9000 : 2000)])); }));
    }
    if (p[3] === "plan" && req.method === "PATCH") {
      const body = await readBody(req);
      return result(res, await service.mutate(work.id, null, body.baseRevision, w => {
        if (body.volumes) w.volumes = body.volumes.slice(0, 100).map(v => ({ id: w.volumes.some(x => x.id === v.id) ? v.id : createId("volume"), title: String(v.title || "新卷").slice(0, 100), goal: String(v.goal || "").slice(0, 4000) }));
        if (body.chapterIds) {
          if (body.chapterIds.length !== w.chapters.length || new Set(body.chapterIds).size !== w.chapters.length || body.chapterIds.some(id => !w.chapters.some(c => c.id === id))) fail("CHAPTER_ORDER_INVALID");
          w.chapters = body.chapterIds.map(id => w.chapters.find(c => c.id === id));
          for (const c of w.chapters) invalidateDependencies(w, { chapterId: c.id, reason: "章节顺序变化" });
        }
      }));
    }
    if (p[3] === "facts" && req.method === "POST") {
      const body = await readBody(req);
      return result(res, await service.mutate(work.id, null, body.baseRevision, w => {
        ensureVersion(w.canonRevision, body.canonRevision);
        const old = w.canon.facts.find(f => f.id === body.fact.id);
        const fact = normalizeTemporalFact({ ...body.fact, id: old?.id || createId("fact"), updatedAt: nowIso(), createdAt: old?.createdAt || nowIso() });
        if (!fact.predicate || !fact.value) fail("FACT_FIELDS_REQUIRED");
        if (old) { invalidateDependencies(w, { factIds: [old.id], reason: "作者修改设定" }); Object.assign(old, fact); }
        else w.canon.facts.push(fact);
      }));
    }
    if (p[3] === "trash") {
      if (req.method === "GET") return result(res, { chapters: work.deletedChapters });
      if (req.method === "POST" && p[5] === "restore") {
        const body = await readBody(req);
        return result(res, await service.mutate(work.id, null, body.baseRevision, w => {
          const c = w.deletedChapters.find(c => c.id === p[4]); if (!c) fail("TRASH_CHAPTER_NOT_FOUND");
          w.deletedChapters = w.deletedChapters.filter(item => item.id !== c.id);
          w.chapters.push(c);
        }));
      }
    }
    if (p[3] !== "chapters" || !p[4]) return false;
    const chapter = work.chapters.find(c => c.id === p[4]); if (!chapter) return false;
    if (p[5] === "revisions") {
      if (req.method === "GET") return result(res, p[6] ? { chapter: await service.readSnapshot(work, chapter, p[6]) } : { revisions: chapter.revisions });
      const body = await readBody(req);
      if (req.method === "POST") return result(res, await service.mutate(work.id, chapter.id, body.baseRevision, async (w, c) => {
        if (p[7] === "restore") {
          const snapshot = await service.readSnapshot(w, c, p[6]); await service.snapshot(w, c, "restore");
          const before = c.richContent; c.richContent = snapshot.richContent; c.content = richContentToMarkdown(c.richContent); transformScenes(c, before, c.richContent);
          invalidateDependencies(w, { chapterId: c.id, reason: "恢复历史正文" });
        } else await service.snapshot(w, c, "manual", body.name);
      }));
    }
    if (p[5] === "scenes" && req.method === "PATCH") {
      const body = await readBody(req);
      return result(res, await service.mutate(work.id, chapter.id, body.baseRevision, (w, c) => {
        ensureVersion(w.structureRevision, body.structureRevision);
        if (!Array.isArray(body.scenes) || body.scenes.length > 200) fail("SCENES_INVALID");
        c.scenes = body.scenes.map(s => normalizeScene(s, deltaLength(c.richContent)));
        if (new Set(c.scenes.map(s => s.id)).size !== c.scenes.length || c.scenes.some(s => s.end < s.start)) fail("SCENE_RANGES_INVALID");
        if (body.volumeId !== undefined) { if (body.volumeId && !w.volumes.some(v => v.id === body.volumeId)) fail("VOLUME_NOT_FOUND"); c.volumeId = body.volumeId; }
        invalidateDependencies(w, { chapterId: c.id, reason: "场景规划变化" });
      }));
    }
    if (p[5] === "generations" && p[7] === "adjudicate" && req.method === "POST") {
      const body = await readBody(req);
      return result(res, await service.mutate(work.id, chapter.id, body.baseRevision, (w, c) => {
        const record = w.generationRecords.find(r => r.id === p[6] && r.chapterId === c.id); if (!record) fail("GENERATION_NOT_FOUND");
        if (record.baseContentHash !== hash(c) || record.canonRevision !== w.canonRevision) fail("REVIEW_BASIS_STALE");
        adjudicateConflict(record, body.conflictId, { reason: body.reason, baseRevision: body.baseRevision, canonRevision: body.canonRevision, currentRevision: c.revision, currentCanonRevision: w.canonRevision });
        if (!record.conflicts.some(x => x.severity === "hard" && x.status === "open")) record.status = "ready";
        return { generation: record, canAccept: canAccept(record) };
      }));
    }
    if (p[5] === "generations" && p[7] === "merge" && req.method === "POST") {
      const body = await readBody(req);
      const saved = await service.mutate(work.id, chapter.id, body.baseRevision, async (w, c) => {
        const record = w.generationRecords.find(r => r.id === p[6] && r.chapterId === c.id);
        if (!record || !canAccept(record) || record.baseContentHash !== hash(c) || record.canonRevision !== w.canonRevision) fail("GENERATION_STALE");
        const delta = mergeHunks(c, record.hunks || [], body.hunkIds);
        await service.snapshot(w, c, "ai"); const before = c.richContent;
        c.richContent = delta; c.content = richContentToMarkdown(delta); transformScenes(c, before, delta);
        invalidateDependencies(w, { chapterId: c.id, reason: "接受 AI 修改" });
        record.status = "accepted"; record.acceptedAt = nowIso(); record.acceptedHunkIds = body.hunkIds;
        w.canonProposals = w.canonProposals.filter(p => p.generationRecordId !== record.id);
      });
      try {
        const task = await tasks.create({ kind: "review", requestId: `review-merge-${p[6]}`, workId: work.id, chapterId: chapter.id, baseRevision: saved.chapter.revision });
        return result(res, { ...saved, reviewTask: task, needsReview: true, message: "正文已保存，正在重新提取实际正文中的事实。" });
      } catch {
        // The prose transaction has committed. Never report it as a failed write.
        return result(res, { ...saved, needsReview: true, message: "正文已保存，但审校任务未能排队。请在正式设定中重新审校。" });
      }
    }
    if (p[5] === "review" && req.method === "POST") {
      const body = await readBody(req); ensureVersion(chapter.revision, body.baseRevision);
      const task = await tasks.create({ kind: "review", requestId: body.requestId || createId("request"), workId: work.id, chapterId: chapter.id, baseRevision: body.baseRevision });
      return result(res, await tasks.wait(task.id));
    }
    if (p.length === 5 && req.method === "PATCH") {
      const body = await readBody(req);
      return result(res, await service.mutate(work.id, chapter.id, body.baseRevision, async (w, c) => {
        const before = c.richContent;
        if (body.richContent || body.content !== undefined) {
          const delta = body.richContent ? normalizeRichContent(body.richContent) : plainTextToRichContent(body.content);
          if (JSON.stringify(delta) !== JSON.stringify(before)) { await service.snapshot(w, c, "auto"); c.richContent = delta; c.content = richContentToMarkdown(delta); transformScenes(c, before, delta); invalidateDependencies(w, { chapterId: c.id, reason: "正文编辑" }); }
        }
        for (const key of ["title", "notes", "status"]) if (body[key] !== undefined) c[key] = String(body[key]).slice(0, key === "notes" ? 10000 : 150);
        if (body.planning) c.planning = body.planning;
      }));
    }
    if (p.length === 5 && req.method === "DELETE") {
      const body = await readBody(req);
      return result(res, await service.mutate(work.id, chapter.id, body.baseRevision, async (w, c) => {
        await service.snapshot(w, c, "delete"); invalidateDependencies(w, { chapterId: c.id, reason: "章节删除" });
        c.deletedAt = nowIso(); w.deletedChapters.push(c); w.chapters = w.chapters.filter(x => x.id !== c.id);
      }));
    }
    return false;
  };
}
module.exports = { createBetaApi };
