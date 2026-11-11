"use strict";
function taskErrorText(task) { return task.errorCode ? describeServerError({ code: task.errorCode, params: task.errorParams, message: task.message }) : (task.message || ""); }
const betaStatus = value => ({ planned: "待写", draft: "草稿", done: "已完成", queued: "排队中", generating: "生成中", checking: "审校中", completed: "已完成", failed: "失败", cancelled: "已取消", interrupted: "已中断" })[value] || value;
let activeSceneId = "", activeTaskId = "";
const betaBody = () => document.querySelector("#betaBody");
const betaMessage = message => { let el = document.querySelector("#betaMessage"); if (!el) { el = document.createElement("p"); el.id = "betaMessage"; betaBody().prepend(el); } el.textContent = message; };
const field = (name, label, value = "", type = "text") => `<label>${escapeHtml(label)}<input name="${name}" type="${type}" value="${escapeHtml(value ?? "")}"></label>`;
const area = (name, label, value = "") => `<label>${escapeHtml(label)}<textarea name="${name}">${escapeHtml(value)}</textarea></label>`;
async function refreshBetaWork() {
  if (!state.work) return;
  const { work } = await request(`/api/works/${state.work.id}`); state.work = work;
  if (!work.chapters.some(c => c.id === state.currentChapterId)) state.currentChapterId = work.chapters[0]?.id || "";
  renderChapters(); renderHeader(); renderLibrary(); loadChapterIntoEditor();
}
function betaForm(html, onSubmit) {
  betaBody().innerHTML = `<form id="betaForm">${html}<button class="primary-button" type="submit">保存</button></form>`;
  document.querySelector("#betaForm").onsubmit = async e => { e.preventDefault(); const button = e.target.querySelector('[type=submit]'); button.disabled = true; try { await onSubmit(Object.fromEntries(new FormData(e.target))); } catch (error) { betaMessage(error.message); } finally { button.disabled = false; } };
}
async function showBeta(type) {
  if (state.editorDirty) { await saveChapterNow(); if (state.editorDirty) return showToast("请先处理正文保存冲突。"); }
  if (!["import", "backup", "usage"].includes(type) && !state.work) return showToast("请先创建或导入作品。");
  const names = { history: "章节历史", scenes: "场景规划", trash: "章节回收站", import: "导入作品", search: "搜索作品", facts: "正式设定与人物认知", preferences: "写作偏好", usage: "用量与任务", backup: "备份与恢复" };
  document.querySelector("#betaTitle").textContent = names[type]; betaBody().textContent = "正在读取…"; openDialog("betaDialog"); closeMenus();
  const work = state.work, chapter = currentChapter(), root = work ? `/api/works/${work.id}` : "";
  if (type === "history") {
    if (!chapter) return betaMessage("请选择章节。");
    const { revisions } = await request(`${root}/chapters/${chapter.id}/revisions`);
    betaBody().innerHTML = '<button class="primary-button" id="makeSnapshot">保存命名版本</button>' + [...revisions].reverse().map(r => `<div class="beta-row"><strong>${escapeHtml(r.name || r.source)}</strong> · ${escapeHtml(formatDate(r.createdAt))} · ${r.characters} 字 <button class="quiet-button" data-revision="${r.id}">比较与恢复</button></div>`).join("");
    document.querySelector("#makeSnapshot").onclick = async () => { const name = prompt("版本名称", "重要修改前"); if (name === null) return; await request(`${root}/chapters/${chapter.id}/revisions`, { method: "POST", body: JSON.stringify({ baseRevision: chapter.revision, name }) }); await showBeta(type); };
    betaBody().querySelectorAll("[data-revision]").forEach(button => button.onclick = async () => {
      const id = button.dataset.revision, { chapter: old } = await request(`${root}/chapters/${chapter.id}/revisions/${id}`);
      betaBody().innerHTML = `<div class="beta-diff"><section>历史版本<pre>${escapeHtml(old.content)}</pre></section><section>当前版本<pre>${escapeHtml(chapter.content)}</pre></section></div><button id="restoreRevision" class="primary-button">恢复此版本（保留当前稿件）</button>`;
      document.querySelector("#restoreRevision").onclick = async () => { try { await request(`${root}/chapters/${chapter.id}/revisions/${id}/restore`, { method: "POST", body: JSON.stringify({ baseRevision: chapter.revision }) }); await refreshBetaWork(); await showBeta("history"); showToast("已恢复，恢复前正文已保留在历史中。"); } catch (e) { betaMessage(e.message); } };
    });
  } else if (type === "scenes") {
    if (!chapter) return betaMessage("请选择章节。");
    const scenes = structuredClone(chapter.scenes || []);
    betaBody().innerHTML = `<p>场景排序表示规划顺序，不移动已写正文。</p><button id="addScene" class="quiet-button">新建场景</button><button id="addVolume" class="quiet-button">新建分卷</button><div id="sceneList"></div>`;
    const editScene = scene => {
      betaForm(field("title", "名称", scene.title) + field("targetCharacters", "目标字数（200～2000）", scene.targetCharacters || 800, "number") + field("povId", "视角人物 ID", scene.povId) + field("participants", "出场人物", scene.participants) + field("location", "地点", scene.location) + field("timeLabel", "时间说明", scene.timeLabel) + field("storyTime", "故事时间序号（未知留空）", scene.storyTime, "number") + `<label>倒叙 <input type="checkbox" name="flashback" ${scene.flashback ? "checked" : ""}></label>` + [ ["goal", "场景目标"], ["conflict", "冲突"], ["must", "必须发生"], ["mustNot", "不得发生"], ["ending", "结束状态"] ].map(([key, label]) => area(key, label, scene[key])).join("") + field("start", "正文起点", scene.start || 0, "number") + field("end", "正文终点", scene.end || 0, "number") + `<label>状态<select name="status">${["planned", "draft", "done"].map(s => `<option value="${s}" ${s === scene.status ? "selected" : ""}>${betaStatus(s)}</option>`).join("")}</select></label>`, async data => {
        Object.assign(scene, data, { targetCharacters: Number(data.targetCharacters), storyTime: data.storyTime === "" ? null : Number(data.storyTime), flashback: Boolean(data.flashback), start: Number(data.start), end: Number(data.end), needsRelocation: false });
        if (!scenes.includes(scene)) scenes.push(scene);
        await request(`${root}/chapters/${chapter.id}/scenes`, { method: "PATCH", body: JSON.stringify({ baseRevision: chapter.revision, structureRevision: work.structureRevision, scenes }) }); await refreshBetaWork(); await showBeta("scenes");
      });
    };
    document.querySelector("#addScene").onclick = () => editScene({ title: "新场景", start: state.quill.getLength() - 1, end: state.quill.getLength() - 1 });
    document.querySelector("#addVolume").onclick = async () => { const title = prompt("分卷名称"); if (!title) return; await request(`${root}/plan`, { method: "PATCH", body: JSON.stringify({ baseRevision: work.structureRevision, volumes: [...work.volumes, { title }] }) }); await refreshBetaWork(); await showBeta("scenes"); };
    document.querySelector("#sceneList").innerHTML = scenes.map((s, i) => `<div class="beta-row"><strong>${escapeHtml(s.title)}</strong> · ${escapeHtml(betaStatus(s.status))} ${s.needsRelocation ? "需要重新定位" : ""}<p>${escapeHtml(s.goal || "未填写目标")}</p><button data-edit="${i}" class="quiet-button">编辑</button><button data-use="${i}" class="primary-button">在此场景写作</button><button data-up="${i}" class="quiet-button">上移</button></div>`).join("");
    betaBody().querySelectorAll("[data-edit]").forEach(b => b.onclick = () => editScene(scenes[+b.dataset.edit]));
    betaBody().querySelectorAll("[data-use]").forEach(b => b.onclick = () => { const s = scenes[+b.dataset.use]; if (s.needsRelocation) return betaMessage("请先编辑并重新定位此场景。"); activeSceneId = s.id; state.editorSelection = { index: s.start, length: s.end - s.start }; state.quill.setSelection(s.start, s.end - s.start); document.querySelector("#targetWords").value = s.targetCharacters; closeDialog("betaDialog"); openEditorAi(s.end > s.start ? "custom" : "continue"); });
    betaBody().querySelectorAll("[data-up]").forEach(b => b.onclick = async () => { const i = +b.dataset.up; if (!i) return; [scenes[i - 1], scenes[i]] = [scenes[i], scenes[i - 1]]; await request(`${root}/chapters/${chapter.id}/scenes`, { method: "PATCH", body: JSON.stringify({ baseRevision: chapter.revision, structureRevision: work.structureRevision, scenes }) }); await refreshBetaWork(); await showBeta("scenes"); });
  } else if (type === "trash") {
    betaBody().innerHTML = '<button id="trashCurrent" class="quiet-button">当前章节移入回收站</button>' + work.deletedChapters.map(c => `<div class="beta-row">${escapeHtml(c.title)}<button data-restore-chapter="${c.id}" class="quiet-button">恢复</button></div>`).join("");
    document.querySelector("#trashCurrent").onclick = async () => { if (!chapter || !confirm("将当前章节移入回收站？")) return; await request(`${root}/chapters/${chapter.id}`, { method: "DELETE", body: JSON.stringify({ baseRevision: chapter.revision }) }); await refreshBetaWork(); await showBeta("trash"); };
    betaBody().querySelectorAll("[data-restore-chapter]").forEach(b => b.onclick = async () => { await request(`${root}/trash/${b.dataset.restoreChapter}/restore`, { method: "POST", body: JSON.stringify({ baseRevision: work.structureRevision }) }); await refreshBetaWork(); await showBeta("trash"); });
  } else if (type === "preferences") {
    betaForm([["person", "叙事人称"], ["viewpoint", "视角范围"], ["dialogue", "对话与描写偏好"], ["bannedWords", "禁用词"], ["avoid", "避免的写法"], ["samples", "作者自有范文（最多三段，以空行分隔）"]].map(([key,label]) => area(key,label,work.writingPreferences?.[key])).join(""), async data => { await request(`${root}/preferences`, { method: "PATCH", body: JSON.stringify({ ...data, baseRevision: work.structureRevision }) }); await refreshBetaWork(); closeDialog("betaDialog"); showToast("写作偏好已保存。"); });
  } else if (type === "search") {
    betaBody().innerHTML = field("query", "搜索正文、标题和人物别名") + '<div id="searchHits"></div>';
    betaBody().querySelector("input").oninput = async e => { const { hits, entities } = await request(`${root}/search?q=${encodeURIComponent(e.target.value)}`); document.querySelector("#searchHits").innerHTML = hits.map(h => `<button class="beta-row" data-hit="${h.chapterId}">${escapeHtml(h.title)}<p>${escapeHtml(h.excerpt)}</p></button>`).join("") + entities.map(e => `<p>人物：${escapeHtml(e.name)}</p>`).join(""); betaBody().querySelectorAll("[data-hit]").forEach(b => b.onclick = () => { state.currentChapterId = b.dataset.hit; updateView("editor"); loadChapterIntoEditor(); closeDialog("betaDialog"); }); };
  } else if (type === "facts") {
    betaBody().innerHTML = '<button id="addFact" class="primary-button">新增正式事实</button><button id="reviewChapter" class="quiet-button">审校当前章节并提取事实</button>' + (work.canon.facts || []).map((f,i) => `<div class="beta-row"><strong>${escapeHtml(f.predicate)}</strong>：${escapeHtml(f.value)} ${f.needsReview ? "（待复核）" : ""}<p>${escapeHtml(f.excerpt || "")}</p><button class="quiet-button" data-fact="${i}">编辑</button></div>`).join("");
    const edit = fact => betaForm(field("predicate", "事实名称", fact.predicate) + area("value", "内容", fact.value) + `<label>信息类型<select name="scope">${["truth", "belief", "author"].map(s => `<option ${fact.scope === s ? "selected" : ""}>${s}</option>`).join("")}</select></label>` + field("knowerId", "认知所属人物 ID", fact.knowerId) + `<label>认知状态<select name="belief">${["knows", "believes", "mistaken"].map(s => `<option ${fact.belief === s ? "selected" : ""}>${s}</option>`).join("")}</select></label>` + field("storyFrom", "故事时间起点", fact.storyFrom, "number") + field("storyUntil", "故事时间终点（不含）", fact.storyUntil, "number") + field("readerOrder", "读者获知章节序号（从0开始）", fact.readerOrder, "number") + area("excerpt", "来源原文", fact.excerpt), async data => { const parsed = { ...fact, ...data, status: fact.status || "active", strength: fact.strength || "hard", needsReview: false }; for (const k of ["storyFrom", "storyUntil", "readerOrder"]) parsed[k] = data[k] === "" ? null : Number(data[k]); await request(`${root}/facts`, { method: "POST", body: JSON.stringify({ fact: parsed, baseRevision: work.structureRevision, canonRevision: work.canonRevision }) }); await refreshBetaWork(); await showBeta("facts"); });
    document.querySelector("#addFact").onclick = () => edit({}); betaBody().querySelectorAll("[data-fact]").forEach(b => b.onclick = () => edit(work.canon.facts[+b.dataset.fact]));
    document.querySelector("#reviewChapter").onclick = async e => { if (!chapter) return; e.target.disabled = true; betaMessage("正在审校实际正文并提取事实…"); try { const r = await request(`${root}/chapters/${chapter.id}/review`, { method: "POST", body: JSON.stringify({ baseRevision: chapter.revision }) }); await refreshBetaWork(); closeDialog("betaDialog"); if (r.proposal.changes.length) openCanonProposal(r.proposal); else showToast("审校完成，没有新增事实。"); } catch (error) { betaMessage(error.message); e.target.disabled = false; } };
  } else if (type === "usage") {
    const [usage, taskList] = await Promise.all([request("/api/usage"), request(`/api/tasks${work ? `?workId=${work.id}` : ""}`)]);
    betaBody().innerHTML = `<p>已报告用量 ${usage.totalTokens} token；每日上限 ${usage.dailyTokenLimit}。未知用量调用 ${usage.unknownCalls} 次，按预留用量占用额度。</p><p>未配置价格，因此不估算金额。</p>` + taskList.tasks.map(t => `<div class="beta-row">${escapeHtml(betaStatus(t.status))} · ${escapeHtml(formatDate(t.createdAt))}<p>${escapeHtml(taskErrorText(t))}</p><details><summary>查看草稿</summary><p style="white-space:pre-wrap">${escapeHtml(t.result?.text || t.draft || "暂无")}</p></details></div>`).join("");
  } else if (type === "import") {
    betaBody().innerHTML = '<p>支持 TXT、Markdown、DOCX，最大20MB。仅导入稿件，不会自动调用 AI。</p><input id="importFile" type="file" accept=".txt,.md,.markdown,.docx"><label>编码<select id="importEncoding"><option value="auto">自动</option><option value="utf-8">UTF-8</option><option value="gb18030">GB18030</option></select></label><button id="parseImport" class="primary-button">读取并预览</button>';
    document.querySelector("#parseImport").onclick = async e => { const file = document.querySelector("#importFile").files[0]; if (!file) return betaMessage("请选择文件。"); e.target.disabled = true; try {
      const base64 = await new Promise((resolve,reject) => { const r = new FileReader(); r.onload = () => resolve(r.result.split(",")[1]); r.onerror = reject; r.readAsDataURL(file); });
      const { preview } = await request("/api/imports", { method: "POST", body: JSON.stringify({ fileName: file.name, base64, encoding: document.querySelector("#importEncoding").value }) });
      betaForm(field("title", "作品名称", preview.title) + `<p>${escapeHtml(preview.warnings.join("；"))}</p><div id="importChapters">${preview.chapters.map((c,i) => `<section class="beta-row" data-import-index="${i}">${field(`title${i}`, "章节标题", c.title)}${area(`content${i}`, "正文", c.content)}<button type="button" data-split="${i}">从光标处分章</button><button type="button" data-join="${i}">合并下一章</button></section>`).join("")}</div>`, async data => {
        const chapters = [...document.querySelectorAll("[data-import-index]")].map(row => ({ sourceIndex: /^\d+$/.test(row.dataset.importIndex) ? Number(row.dataset.importIndex) : null, title: row.querySelector("input").value, content: row.querySelector("textarea").value }));
        const { work } = await request(`/api/imports/${preview.id}/confirm`, { method: "POST", body: JSON.stringify({ title: data.title, chapters }) });
        await loadWorks(); await loadWork(work.id); closeDialog("betaDialog"); showToast("作品已导入。可在正式设定中提取事实。");
      });
      betaBody().querySelectorAll("[data-join]").forEach(b => b.onclick = () => { const row = b.closest("section"), next = row.nextElementSibling; if (next) { row.querySelector("textarea").value += "\n\n" + next.querySelector("input").value + "\n" + next.querySelector("textarea").value; next.remove(); } });
      betaBody().querySelectorAll("[data-split]").forEach(b => b.onclick = () => { const row = b.closest("section"), input = row.querySelector("textarea"), pos = input.selectionStart; if (!pos || pos >= input.value.length) return betaMessage("先把正文光标放到分章位置。"); const next = document.createElement("section"); next.className = "beta-row"; next.dataset.importIndex = "new"; next.innerHTML = field("newTitle", "章节标题", "新章节") + area("newContent", "正文", input.value.slice(pos)); input.value = input.value.slice(0,pos); row.after(next); });
    } catch (error) { betaMessage(error.message); e.target.disabled = false; } };
  } else if (type === "backup") {
    betaBody().innerHTML = '<a class="primary-button" href="/api/backup">下载完整备份</a><p>恢复会替换当前作品库，恢复前自动保留备份。</p><input id="restoreFile" type="file" accept=".json"><button id="restoreBackup" class="quiet-button">读取恢复预览</button>';
    document.querySelector("#restoreBackup").onclick = async () => { const file = document.querySelector("#restoreFile").files[0]; if (!file) return; try { const data = JSON.parse(await file.text()); if (!Array.isArray(data.database?.works)) throw new Error("无效备份"); if (!confirm(`备份含${data.database.works.length}部作品，将替换当前作品库。继续？`)) return; await request("/api/backup/restore", { method: "POST", body: JSON.stringify(data) }); await loadWorks(); closeDialog("betaDialog"); showToast("备份已恢复。"); } catch (e) { betaMessage(e.message); } };
  }
}
document.addEventListener("click", e => { const button = e.target.closest("[data-beta]"); if (button) showBeta(button.dataset.beta).catch(error => betaMessage(error.message)); });
document.querySelector("#cancelWritingTask").onclick = async () => { if (activeTaskId) await request(`/api/tasks/${activeTaskId}/cancel`, { method: "POST", body: "{}" }); };
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-adjudicate]"); if (!b || !state.aiEditResult) return;
  const reason = prompt("请说明为什么是误判（将连同依据保存）"); if (!reason) return;
  const record = state.aiEditResult.generation;
  try { const response = await request(`/api/works/${state.work.id}/chapters/${currentChapter().id}/generations/${record.id}/adjudicate`, { method: "POST", body: JSON.stringify({ conflictId: b.dataset.adjudicate, reason, baseRevision: currentChapter().revision, canonRevision: state.work.canonRevision }) });
    state.aiEditResult.generation = response.generation; state.aiEditResult.canAccept = response.canAccept; renderEditorAiDiagnostics(response.generation, response.canAccept);
    const accept = document.querySelector("[data-accept-ai-edit]"); if (accept && response.canAccept) { accept.disabled = false; accept.textContent = "接受选中修改"; }
  } catch(error) { showToast(error.message); }
});
async function betaGenerate(body) {
  const { task } = await request("/api/tasks", { method: "POST", body: JSON.stringify({ ...body, requestId: crypto.randomUUID(), baseRevision: currentChapter().revision, sceneId: currentChapter().scenes?.some(s => s.id === activeSceneId) ? activeSceneId : "", autoRewrite: document.querySelector("#autoRewrite").checked }) });
  if (task.status === "completed") return task.result;
  activeTaskId = task.id;
  return new Promise((resolve, reject) => {
    let closed = false, timer;
    const stream = new EventSource(`/api/tasks/${task.id}/events`);
    function done(t) {
      if (closed) return;
      document.querySelector("#editorAiBody").textContent = ({ queued: "任务已排队", generating: "正在生成正文…", checking: "正在审校…" })[t.status] || taskErrorText(t) || "正在完成…";
      if (["completed", "failed", "cancelled", "interrupted"].includes(t.status)) {
        closed = true; stream.close(); clearInterval(timer); activeTaskId = "";
        if (t.status === "completed") resolve(t.result);
        else { const error = new Error(taskErrorText(t) || "任务中断"); error.status = t.errorStatus || (t.status === "failed" ? 500 : 409); reject(error); }
      }
    }
    stream.addEventListener("task", e => done(JSON.parse(e.data)));
    stream.onerror = () => { stream.close(); if (!timer && !closed) timer = setInterval(() => request(`/api/tasks/${task.id}`).then(r => done(r.task)).catch(() => {}), 1500); };
  });
}
function showSaveConflict(localDelta, chapterId) {
  const workId = state.work.id;
  const stillEditing = () => state.work?.id === workId && state.currentChapterId === chapterId;
  request(`/api/works/${workId}`).then(({ work }) => {
    if (!stillEditing()) return;
    const remote = work.chapters.find(c => c.id === chapterId); if (!remote) return showToast("章节已被删除，当前编辑仍保留，请复制另存。");
    document.querySelector("#betaTitle").textContent = "保存冲突：请选择保留内容";
    betaBody().innerHTML = `<div class="beta-diff"><section>本窗口草稿<pre>${escapeHtml(state.quill.getText())}</pre></section><section>已保存版本<pre>${escapeHtml(remote.content)}</pre></section></div><button id="keepLocal" class="primary-button">以当前草稿保存（先保留远端快照）</button><button id="keepRemote" class="quiet-button">使用已保存版本</button>`; openDialog("betaDialog");
    document.querySelector("#keepLocal").onclick = async e => {
      if (!stillEditing()) return betaMessage("当前章节已切换，请重新打开冲突比较。");
      const submitted = structuredClone(state.quill.getContents());
      e.target.disabled = true;
      try {
        await request(`/api/works/${work.id}/chapters/${chapterId}/revisions`, { method: "POST", body: JSON.stringify({ baseRevision: remote.revision, name: "并发合并前" }) });
        const r = await request(`/api/works/${work.id}/chapters/${chapterId}`, { method: "PATCH", body: JSON.stringify({ baseRevision: remote.revision, richContent: submitted }) });
        if (!stillEditing()) return;
        // Do not reload the editor over typing performed while the save was in flight.
        state.work.chapters[state.work.chapters.findIndex(c => c.id === chapterId)] = r.chapter;
        state.editorDirty = JSON.stringify(state.quill.getContents()) !== JSON.stringify(submitted);
        renderChapters(); renderHeader(); closeDialog("betaDialog");
        if (state.editorDirty) showToast("已保存比较稿；保存期间的新输入仍保留，请继续保存。");
      } catch(error) { betaMessage(error.message); } finally { e.target.disabled = false; }
    };
    document.querySelector("#keepRemote").onclick = () => {
      if (!stillEditing()) return;
      if (JSON.stringify(state.quill.getContents()) !== JSON.stringify(localDelta) && !confirm("比较期间又有新输入。确定放弃本窗口内容，使用已保存版本？")) return;
      state.editorDirty = false; state.work = work; loadChapterIntoEditor(); closeDialog("betaDialog");
    };
  }).catch(error => showToast(error.message));
}
