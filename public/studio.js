const ARTIFACTS = {
  outline: {
    index: "01",
    title: "故事大纲",
    intro: "明确故事承诺、核心冲突和阶段推进，让每一章都知道自己要走向哪里。",
    summaryFields: ["logline", "outline"],
    fields: {
      logline: "核心概念",
      theme: "故事主题",
      tone: "叙事风格",
      genrePositioning: "类型定位",
      conflict: "主线冲突",
      antagonistPressure: "对抗压力",
      outline: "故事大纲",
      chapterPlan: "章节规划"
    }
  },
  characters: {
    index: "02",
    title: "人物关系",
    intro: "记录人物的欲望、秘密、成长变化，以及他们彼此之间真正的牵引与冲突。",
    summaryFields: ["characters", "relationships"],
    fields: { characters: "人物设定", relationships: "人物关系" }
  },
  world: {
    index: "03",
    title: "世界观规则",
    intro: "只保留会影响人物选择和剧情结果的规则，让世界设定真正参与故事。",
    summaryFields: ["worldview", "rules"],
    fields: { worldview: "世界设定", rules: "世界规则", era: "时代背景", factions: "阵营势力", locations: "关键地点" }
  },
  timeline: {
    index: "04",
    title: "关键事件时间线",
    intro: "把不可逆的事件、伏笔和连续性事实放在同一条线上，避免长篇创作前后矛盾。",
    summaryFields: ["keyEvents", "foreshadowing"],
    fields: { keyEvents: "关键事件", foreshadowing: "伏笔与回收", continuityNotes: "连续性记录" }
  }
};

const requestedInitialView = new URLSearchParams(window.location.search).get("view");

const state = {
  works: [],
  work: null,
  chats: [],
  proposals: [],
  activeChatId: "",
  currentView: ["ai", "editor", "library"].includes(requestedInitialView) ? requestedInitialView : "ai",
  currentChapterId: "",
  activeArtifact: "outline",
  libraryEditing: false,
  activeProposalId: "",
  quill: null,
  quillReady: false,
  suppressEditorEvents: false,
  editorDirty: false,
  editorSaveTimer: null,
  editorSelection: null,
  aiEditResult: null,
  editorRevision: 0,
  aiAccepting: false,
  aiGenerating: false,
  aiAvailability: { status: "checking", message: "正在检测 AI 接口…" },
  aiProviderStatuses: {},
  activeCanonProposal: null,
  chatAbortController: null,
  toastTimer: null,
  toastAction: null
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function countCharacters(value) {
  return String(value || "").replace(/\s/g, "").length;
}

// The server reports errors as { code, message, params }. This legacy UI is
// Chinese, so it translates codes with the shared zh-CN locale file.
const serverErrorText = { messages: null };
fetch("/locales/zh-CN.json")
  .then((response) => (response.ok ? response.json() : null))
  .then((data) => { serverErrorText.messages = data?.errors || null; })
  .catch(() => {});

function describeServerError(error, fallback = "") {
  if (!error) return fallback;
  if (typeof error === "string") return error;
  const template = error.code && serverErrorText.messages?.[error.code];
  if (template) {
    const params = error.params || {};
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => (params[key] ?? match));
  }
  return error.message || fallback;
}

async function request(pathname, options = {}) {
  const response = await fetch(pathname, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(describeServerError(payload.error, `请求失败（${response.status}）`));
    error.status = response.status;
    error.code = payload.error?.code || "";
    throw error;
  }
  return payload;
}

function showToast(message, actionLabel = "", action = null) {
  const toast = $("#toast");
  clearTimeout(state.toastTimer);
  state.toastAction = action;
  toast.replaceChildren(document.createTextNode(message));
  if (actionLabel && action) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = actionLabel;
    button.addEventListener("click", async () => {
      const callback = state.toastAction;
      state.toastAction = null;
      toast.classList.remove("show");
      await callback?.();
    }, { once: true });
    toast.append(button);
  }
  toast.classList.add("show");
  state.toastTimer = setTimeout(() => toast.classList.remove("show"), action ? 6500 : 3200);
}

function renderAiAvailability() {
  const button = $("#aiAvailabilityButton");
  if (!button) return;
  const { status, message } = state.aiAvailability;
  button.classList.remove("checking", "available", "unavailable");
  button.classList.add(status);
  button.querySelector("strong").textContent = status === "available" ? "AI 可用" : status === "unavailable" ? "AI 不可用" : "AI 检测中";
  button.title = message;
  button.setAttribute("aria-label", `${button.querySelector("strong").textContent}：${message}。点击打开设置`);
}

function syncOpenSettingsAvailability() {
  const dialog = $("#settingsDialog");
  if (!dialog?.open) return;
  $("#settingsStatus").textContent = state.aiAvailability.message;
}

function editorAiUnavailableMarkup(message = state.aiAvailability.message) {
  return `<div class="ai-unavailable-card"><strong>AI 不可用</strong><p>${escapeHtml(message || "请检查 API 设置和网络后重试。")}</p><button class="quiet-button" type="button" data-open-ai-settings>打开 AI 设置</button></div>`;
}

function clearEditorAiDiagnostics() {
  const meta = $("#editorAiRunMeta");
  const context = $("#editorAiContextDetails");
  const contextList = $("#editorAiContextList");
  const validation = $("#editorAiValidationReport");
  meta?.classList.add("hidden");
  context?.classList.add("hidden");
  if (context) context.open = false;
  validation?.classList.add("hidden");
  validation?.classList.remove("warning", "has-hard-conflict");
  if (meta) meta.innerHTML = "";
  if (contextList) contextList.innerHTML = "";
  if (validation) validation.innerHTML = "";
}

function invalidateAiEditResult(message = "正文已变化，请重新生成预览。") {
  state.editorRevision += 1;
  if (!state.aiEditResult) return;
  state.aiEditResult = null;
  clearEditorAiDiagnostics();
  const body = $("#editorAiBody");
  if (body) body.innerHTML = `<p>${escapeHtml(message)}</p>`;
}

async function checkAiAvailability({ notify = false } = {}) {
  state.aiAvailability = { status: "checking", message: "正在检测 AI 接口…" };
  renderAiAvailability();
  try {
    const result = await request("/api/ai/test", { method: "POST", body: "{}" });
    state.aiAvailability = {
      status: result.ok ? "available" : "unavailable",
      message: result.ok ? (result.message || "AI 接口可用。") : describeServerError(result, "AI 接口不可用。")
    };
  } catch (error) {
    state.aiAvailability = { status: "unavailable", message: error.message || "无法检测 AI 接口。" };
  }
  renderAiAvailability();
  syncOpenSettingsAvailability();
  if (notify) showToast(state.aiAvailability.message);
  return state.aiAvailability.status === "available";
}

async function ensureAiAvailable({ editor = false } = {}) {
  const available = state.aiAvailability.status === "available"
    ? true
    : await checkAiAvailability();
  if (available) return true;
  const message = state.aiAvailability.message || "请检查 API 设置和网络后重试。";
  if (editor) $("#editorAiBody").innerHTML = editorAiUnavailableMarkup(message);
  showToast(`AI 不可用：${message}`);
  return false;
}

function handleAiFailure(error, { editor = false } = {}) {
  const unavailable = !error.status || error.status === 401 || error.status === 403 || error.status === 429 || error.status >= 500;
  const message = error.message || "AI 请求失败，请稍后重试。";
  if (unavailable) {
    state.aiAvailability = { status: "unavailable", message };
    renderAiAvailability();
  }
  const userMessage = unavailable ? `AI 不可用：${message}` : `AI 生成失败：${message}`;
  if (editor) $("#editorAiBody").innerHTML = unavailable
    ? editorAiUnavailableMarkup(message)
    : `<p class="danger-text">${escapeHtml(userMessage)}</p>`;
  showToast(userMessage);
  return userMessage;
}

function activeChat() {
  return state.chats.find((chat) => chat.id === state.activeChatId) || state.chats[0] || null;
}

function currentChapter() {
  return state.work?.chapters?.find((chapter) => chapter.id === state.currentChapterId) || state.work?.chapters?.[0] || null;
}

function closeMenus() {
  $("#projectMenu").classList.remove("open");
  $("#projectMenu").setAttribute("aria-hidden", "true");
  $$('[data-open-project-menu]').forEach((button) => button.setAttribute("aria-expanded", "false"));
}

function openDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog && !dialog.open) dialog.showModal();
}

function closeDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog?.open) dialog.close();
}

function setSaveState(status, label) {
  const indicator = $("#editorSaveState");
  indicator.dataset.state = status;
  indicator.textContent = label;
}

async function loadWorks(preferredId = "") {
  const payload = await request("/api/works");
  state.works = payload.works || [];
  renderProjectMenu();
  if (!state.works.length) {
    state.work = null;
    state.chats = [];
    state.proposals = [];
    state.activeChatId = "";
    renderAll();
    return;
  }
  const storedId = localStorage.getItem("motai-current-work") || "";
  const target = state.works.find((work) => work.id === preferredId)
    || state.works.find((work) => work.id === storedId)
    || state.works[0];
  await loadWork(target.id);
}

async function loadWork(workId) {
  if (state.aiAccepting) return showToast("正在写入正文，请稍候再切换作品。");
  if (state.editorDirty) await saveChapterNow();
  const [{ work }, chatPayload] = await Promise.all([
    request(`/api/works/${encodeURIComponent(workId)}`),
    request(`/api/works/${encodeURIComponent(workId)}/chats`)
  ]);
  state.work = work;
  state.chats = chatPayload.chats || [];
  state.proposals = chatPayload.proposals || [];
  state.activeChatId = chatPayload.activeChatId || state.chats[0]?.id || "";
  state.currentChapterId = work.chapters?.some((chapter) => chapter.id === state.currentChapterId)
    ? state.currentChapterId
    : work.chapters?.[0]?.id || "";
  localStorage.setItem("motai-current-work", work.id);
  renderAll();
  loadChapterIntoEditor();
}

function renderAll() {
  renderHeader();
  renderProjectMenu();
  renderChats();
  renderConversation();
  renderArtifactCards();
  renderChapters();
  renderLibrary();
  updateView(state.currentView);
}

function renderHeader() {
  $("#currentWorkTitle").textContent = state.work?.title || "还没有作品";
  $("#currentWorkMeta").textContent = state.work
    ? `${state.work.genre || "原创"} · ${(state.work.chapters || []).reduce((total, chapter) => total + countCharacters(chapter.content), 0)} 字`
    : "新建作品后开始创作";
}

function renderProjectMenu() {
  const list = $("#projectMenuList");
  list.innerHTML = state.works.length
    ? state.works.map((work) => `<button type="button" class="${work.id === state.work?.id ? "active" : ""}" data-switch-work="${escapeHtml(work.id)}">${escapeHtml(work.title || "未命名作品")}</button>`).join("")
    : '<button type="button" disabled>暂无作品</button>';
  $("#projectInfoButton").disabled = !state.work;
  $("#deleteWorkButton").disabled = !state.work;
  $("#exportButton").disabled = !state.work;
}

function updateView(view) {
  state.currentView = ["ai", "editor", "library"].includes(view) ? view : "ai";
  $$('[data-screen]').forEach((screen) => screen.classList.toggle("active", screen.dataset.screen === state.currentView));
  $$('.rail-item[data-view]').forEach((button) => {
    const active = button.dataset.view === state.currentView;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
  const titles = {
    ai: ["AI 创作", "和 AI 一起把灵感变成可以写的故事"],
    editor: ["正文", "专注书写，随时调用 AI"],
    library: ["创作资料", "管理故事的结构与事实"]
  };
  $("#stageTitle").textContent = titles[state.currentView][0];
  $("#stageSubtitle").textContent = titles[state.currentView][1];
  $$('.ai-only').forEach((element) => element.classList.toggle("hidden", state.currentView !== "ai"));
  if (state.currentView === "editor") {
    requestAnimationFrame(() => state.quill?.focus());
  }
}

function renderChats() {
  const list = $("#chatList");
  list.innerHTML = state.chats.map((chat) => `
    <div class="chat-row ${chat.id === state.activeChatId ? "active" : ""}">
      <button class="chat-row-main" type="button" data-select-chat="${escapeHtml(chat.id)}">
        <strong>${escapeHtml(chat.title || "新对话")}</strong>
        <small>${formatDate(chat.updatedAt)}</small>
      </button>
      <button class="chat-row-menu" type="button" data-chat-menu="${escapeHtml(chat.id)}" aria-label="对话菜单">•••</button>
    </div>
  `).join("");
}

function renderConversation() {
  const conversation = $("#conversation");
  const chat = activeChat();
  if (!state.work) {
    conversation.innerHTML = `
      <div class="ai-empty">
        <div class="empty-mark">墨</div>
        <h2>从一个故事念头开始</h2>
        <p>创建作品后，你可以像聊天一样确定灵感、人物和大纲，再把确认后的内容写入创作资料。</p>
        <button class="primary-button" type="button" data-create-first-work>创建第一个作品</button>
      </div>`;
    $("#chatInput").disabled = true;
    syncChatSubmitState();
    return;
  }
  $("#chatInput").disabled = false;
  syncChatSubmitState();
  if (!chat?.messages?.length) {
    conversation.innerHTML = `
      <div class="ai-empty">
        <div class="empty-mark">墨</div>
        <h2>一起把这个故事想清楚</h2>
        <p>${state.work.premise ? escapeHtml(state.work.premise) : "不必先准备完整设定。告诉我你脑海里最清楚的那个画面、人物或冲突。"}</p>
        <div class="starter-prompts">
          <button type="button" data-chat-prompt="帮我从一句灵感开始梳理这个故事">从灵感开始</button>
          <button type="button" data-chat-prompt="帮我找到主角真正想要什么，以及最大的阻力">确定核心冲突</button>
          <button type="button" data-generate-artifact="outline">整理故事大纲</button>
        </div>
      </div>`;
    return;
  }
  const messages = chat.messages.map((message) => `
    <article class="message ${message.role} ${message.status === "interrupted" ? "interrupted" : ""}" data-message-id="${escapeHtml(message.id)}">
      <div class="message-head"><span class="message-avatar">${message.role === "assistant" ? "墨" : "你"}</span><span>${message.role === "assistant" ? "墨台 AI" : "作者"}</span></div>
      <div class="message-body">${escapeHtml(message.content)}</div>
      ${message.status === "interrupted" ? `<div class="message-status">生成已中断 <button type="button" data-retry-message="${escapeHtml(message.id)}">重试</button></div>` : ""}
    </article>
  `).join("");
  const proposals = state.proposals
    .filter((proposal) => proposal.chatId === chat.id && proposal.status !== "discarded")
    .map(renderInlineProposal)
    .join("");
  conversation.innerHTML = messages + proposals;
  requestAnimationFrame(() => { conversation.scrollTop = conversation.scrollHeight; });
}

function renderInlineProposal(proposal) {
  const artifact = ARTIFACTS[proposal.type];
  const statusLabels = { pending: "待确认", applied: "已写入", reverted: "已撤销" };
  return `
    <section class="proposal-inline" data-proposal-card="${escapeHtml(proposal.id)}">
      <div class="proposal-inline-top">
        <div><strong>已整理：${escapeHtml(artifact?.title || "创作资料")}草案</strong><small>${proposal.sections.length} 个部分 · ${statusLabels[proposal.status] || proposal.status}</small></div>
        <div class="proposal-inline-actions">
          <button type="button" data-open-proposal="${escapeHtml(proposal.id)}">查看</button>
          ${proposal.status === "pending" ? `<button type="button" data-apply-proposal="${escapeHtml(proposal.id)}">确认写入</button>` : ""}
          ${proposal.status === "applied" ? `<button type="button" data-revert-proposal="${escapeHtml(proposal.id)}">撤销</button>` : ""}
        </div>
      </div>
    </section>`;
}

function artifactSummary(type) {
  const artifact = ARTIFACTS[type];
  const bible = state.work?.storyBible || {};
  return artifact.summaryFields.map((field) => bible[field]).find(Boolean) || "还没有内容，可以和 AI 一起整理。";
}

function artifactHasContent(type) {
  const artifact = ARTIFACTS[type];
  const bible = state.work?.storyBible || {};
  return Object.keys(artifact.fields).some((field) => String(bible[field] || "").trim());
}

function renderArtifactCards() {
  $("#artifactCards").innerHTML = Object.entries(ARTIFACTS).map(([type, artifact]) => `
    <div class="artifact-card" data-open-library="${type}" role="button" tabindex="0">
      <div class="artifact-card-top"><strong>${artifact.title}</strong><span class="artifact-card-status ${artifactHasContent(type) ? "ready" : ""}">${artifactHasContent(type) ? "已有内容" : "未整理"}</span></div>
      <p>${escapeHtml(artifactSummary(type))}</p>
      <button class="artifact-generate" type="button" data-generate-artifact="${type}"><span>让 AI ${artifactHasContent(type) ? "优化" : "整理"}</span><span>→</span></button>
    </div>
  `).join("");
}

function renderChapters() {
  const chapters = state.work?.chapters || [];
  const chapter = currentChapter();
  $("#chapterCountLabel").textContent = `${chapters.length} 个章节`;
  $("#chapterList").innerHTML = chapters.map((chapter, index) => `
    <button class="chapter-row ${chapter.id === state.currentChapterId ? "active" : ""}" type="button" data-chapter-id="${escapeHtml(chapter.id)}">
      <strong>${escapeHtml(chapter.title || `第${index + 1}章`)}</strong>
      <small>${countCharacters(chapter.content)} 字</small>
    </button>
  `).join("");
  $("#addChapterButton").disabled = !state.work;
  $("#chapterTitleInput").disabled = !chapter;
  $("#toggleEditorAiButton").disabled = !chapter;
  if (state.quill) {
    state.quill.enable(Boolean(chapter) && !state.aiAccepting);
    if (!chapter) {
      state.suppressEditorEvents = true;
      state.quill.setContents([{ insert: "\n" }], "silent");
      state.quill.history.clear();
      state.editorDirty = false;
      state.suppressEditorEvents = false;
      $("#chapterTitleInput").value = "";
      setSaveState("saved", state.work ? "请先新建章节" : "请先新建作品");
    }
  }
}

function initQuill() {
  if (state.quillReady || !window.Quill) return;
  state.quill = new window.Quill("#richEditor", {
    theme: "snow",
    placeholder: "从这里开始写……",
    modules: { toolbar: "#editorToolbar", history: { delay: 700, maxStack: 120, userOnly: true } },
    formats: ["bold", "italic", "header", "blockquote", "list", "link", "image"]
  });
  state.quill.on("text-change", (_delta, _oldDelta, source) => {
    if (source !== "user" || state.suppressEditorEvents) return;
    invalidateAiEditResult();
    state.editorDirty = true;
    scheduleChapterSave();
  });
  state.quill.on("selection-change", (range) => {
    if (!range || range.length <= 0) {
      state.editorSelection = range;
      $("#selectionTools").classList.add("hidden");
      return;
    }
    state.editorSelection = range;
    positionSelectionTools(range);
  });
  state.quillReady = true;
}

function loadChapterIntoEditor() {
  initQuill();
  invalidateAiEditResult("章节已经切换，请为当前章节重新生成预览。");
  const chapter = currentChapter();
  if (!state.quill || !chapter) {
    $("#chapterTitleInput").value = "";
    return;
  }
  clearTimeout(state.editorSaveTimer);
  const wasSuppressingEditorEvents = state.suppressEditorEvents;
  state.suppressEditorEvents = true;
  const rich = chapter.richContent?.ops ? chapter.richContent : { ops: [{ insert: `${chapter.content || ""}\n` }] };
  state.quill.setContents(rich.ops, "silent");
  state.quill.history.clear();
  $("#chapterTitleInput").value = chapter.title || "";
  state.editorDirty = false;
  state.suppressEditorEvents = wasSuppressingEditorEvents;
  setSaveState("saved", "已保存");
}

function positionSelectionTools(range) {
  const bounds = state.quill.getBounds(range);
  const editorRect = $("#richEditor").getBoundingClientRect();
  const toolbar = $("#selectionTools");
  toolbar.classList.remove("hidden");
  const width = toolbar.offsetWidth || 260;
  const left = Math.min(window.innerWidth - width - 12, Math.max(12, editorRect.left + bounds.left + (bounds.width / 2) - (width / 2)));
  const top = Math.max(78, editorRect.top + bounds.top - 50);
  toolbar.style.left = `${left}px`;
  toolbar.style.top = `${top}px`;
}

function scheduleChapterSave() {
  setSaveState("saving", "保存中…");
  clearTimeout(state.editorSaveTimer);
  state.editorSaveTimer = setTimeout(() => saveChapterNow(), 800);
}

async function saveChapterNow() {
  if (state.savingPromise) { await state.savingPromise; if (!state.editorDirty) return; }
  let finishSave;
  state.savingPromise = new Promise(resolve => { finishSave = resolve; });
  clearTimeout(state.editorSaveTimer);
  const work = state.work;
  const chapter = currentChapter();
  if (!work || !chapter || !state.quill || !state.editorDirty) { finishSave(); state.savingPromise = null; return; }
  const workId = work.id;
  const chapterId = chapter.id;
  const savedRevision = state.editorRevision;
  const title = $("#chapterTitleInput").value.trim() || chapter.title || "未命名章节";
  const richContent = { version: 1, ops: state.quill.getContents().ops };
  setSaveState("saving", "保存中…");
  try {
    const payload = await request(`/api/works/${encodeURIComponent(workId)}/chapters/${encodeURIComponent(chapterId)}`, {
      method: "PATCH",
      body: JSON.stringify({ title, richContent, baseRevision: chapter.revision })
    });
    if (state.work?.id === workId) {
      const index = state.work.chapters.findIndex((item) => item.id === chapterId);
      if (index >= 0) state.work.chapters[index] = payload.chapter;
      if (currentChapter()?.id === chapterId && state.editorRevision === savedRevision) {
        state.editorDirty = false;
        setSaveState("saved", "已保存");
      }
      renderChapters();
      renderHeader();
    }
  } catch (error) {
    setSaveState("error", "保存失败");
    showToast(error.message);
    if (error.status === 409) showSaveConflict(richContent, chapterId);
  } finally {
    finishSave(); state.savingPromise = null;
  }
}

async function addChapter() {
  if (state.aiAccepting) return showToast("正在写入正文，请稍候再新建章节。");
  if (!state.work) return;
  await saveChapterNow();
  const payload = await request(`/api/works/${encodeURIComponent(state.work.id)}/chapters`, { method: "POST", body: "{}" });
  state.work = payload.work;
  state.currentChapterId = payload.chapter.id;
  renderChapters();
  loadChapterIntoEditor();
  showToast("已新建章节");
}

function openEditorAi(mode = "") {
  const chapter = currentChapter();
  if (!state.work || !chapter || !state.quill) {
    showToast("请先打开作品并新建章节。");
    return;
  }
  const range = state.editorSelection || state.quill.getSelection() || { index: state.quill.getLength() - 1, length: 0 };
  state.editorSelection = range;
  const hasSelection = range.length > 0;
  const requestedMode = mode === "ask" || !mode ? (hasSelection ? "custom" : "continue") : mode;
  $("#editorAiMode").value = requestedMode;
  $("#editorAiContext").textContent = hasSelection
    ? `已选中 ${range.length} 个字；“继续创作”会追加到章节末尾，其他方式会处理选中内容。`
    : "未选中文字；可以继续当前章节，或按指令在光标位置创作内容。";
  $("#selectionTools").classList.add("hidden");
  $(".editor-screen").classList.add("ai-panel-open");
  if (window.innerWidth < 1100) $(".editor-screen").classList.remove("panel-open");
  $("#editorAiPanel").setAttribute("aria-hidden", "false");
  if (!state.aiEditResult) {
    $("#editorAiBody").innerHTML = state.aiAvailability.status === "unavailable"
      ? editorAiUnavailableMarkup()
      : "<p>写下本次要求，再生成预览。你可以修改指令并反复生成，不会直接改动正文。</p>";
  }
  $("#editorAiInstruction").focus();
}

async function generateEditorAiDraft() {
  if (state.aiGenerating || state.aiAccepting) return;
  if (!state.work || !currentChapter() || !state.quill) {
    showToast("请先打开作品并新建章节。");
    return;
  }
  const requestedWorkId = state.work.id;
  const requestedChapterId = currentChapter().id;
  const requestedRevision = state.editorRevision;
  const isCurrent = () => state.work?.id === requestedWorkId && currentChapter()?.id === requestedChapterId && state.editorRevision === requestedRevision;
  await saveChapterNow();
  if (!isCurrent()) return;
  if (state.editorDirty) {
    showToast("正文尚未保存，不能基于旧版本生成。");
    return;
  }
  const chapter = currentChapter();
  const mode = $("#editorAiMode").value;
  const instruction = $("#editorAiInstruction").value.trim();
  const range = state.editorSelection || state.quill.getSelection() || { index: state.quill.getLength() - 1, length: 0 };
  const usesSelection = mode !== "continue" && range.length > 0;
  const selectedText = usesSelection ? state.quill.getText(range.index, range.length) : "";
  if (["expand", "polish", "shorten"].includes(mode) && !selectedText.trim()) {
    showToast("请先在正文中选中要处理的内容。");
    return;
  }
  if (!await ensureAiAvailable({ editor: true })) return;
  if (!isCurrent()) return;
  const applyRange = mode === "continue"
    ? { index: Math.max(0, state.quill.getLength() - 1), length: 0 }
    : range;
  $("#generateEditorAiButton").disabled = true;
  state.aiGenerating = true;
  $("#generateEditorAiButton").textContent = "正在生成…";
  state.aiEditResult = null;
  clearEditorAiDiagnostics();
  $("#editorAiBody").innerHTML = "<p>AI 正在阅读当前章节、创作资料和你的指令…</p>";
  try {
    const payload = await betaGenerate({
        workId: requestedWorkId,
        chapterId: chapter.id,
        mode,
        instruction: `${instruction}\n目标约 ${Number($("#targetWords").value) || 800} 字。`,
        selectedText,
        range: applyRange,
        baseChapterUpdatedAt: chapter.updatedAt || ""
    });
    if (!isCurrent()) return;
    const generation = payload.generation || {};
    const canAccept = payload.canAccept !== false;
    state.aiEditResult = {
      mode,
      workId: requestedWorkId,
      chapterId: requestedChapterId,
      editorRevision: requestedRevision,
      instruction,
      text: payload.text,
      range: applyRange,
      generation,
      generationId: generation.id || "",
      canAccept,
      baseChapterUpdatedAt: chapter.updatedAt || ""
    };
    renderEditorAiDiagnostics(generation, canAccept);
    const applyLabel = applyRange.length ? "替换选中内容" : "插入正文";
    const blockedHint = canAccept ? "" : '<p class="ai-edit-blocked">检测到未解决的硬冲突。请修改上方指令后重新生成，当前结果不能写入正文。</p>';
    $("#editorAiBody").innerHTML = `
      <div class="ai-edit-result">${escapeHtml(payload.text)}</div>
      ${(generation.hunks || []).map(h => `<label class="beta-row"><input type="checkbox" name="accepted-hunk" value="${escapeHtml(h.id)}" checked> 接受此段<div class="hunk-before">${escapeHtml(h.before)}</div><div class="hunk-after">${escapeHtml(h.after)}</div></label>`).join("")}
      ${payload.warning ? `<p class="ai-edit-warning">${escapeHtml(payload.warning)}</p>` : ""}
      ${blockedHint}
      <div class="ai-edit-actions"><button class="quiet-button" type="button" data-reject-ai-edit>清除预览</button>${canAccept ? "" : '<button class="quiet-button" type="button" data-regenerate-ai-edit>按问题重新生成</button>'}<button class="primary-button" type="button" data-accept-ai-edit ${canAccept ? "" : "disabled"}>${canAccept ? applyLabel : "存在硬冲突，不能写入"}</button></div>`;
  } catch (error) {
    if (isCurrent()) handleAiFailure(error, { editor: true });
  } finally {
    state.aiGenerating = false;
    $("#generateEditorAiButton").disabled = false;
    $("#generateEditorAiButton").textContent = "生成预览";
  }
}

function renderEditorAiDiagnostics(generation, canAccept) {
  const context = generation.context || {};
  const canonFactIds = Array.isArray(context.canonFactIds) ? context.canonFactIds : [];
  const memoryChapterIds = Array.isArray(context.chapterMemoryChapterIds) ? context.chapterMemoryChapterIds : [];
  const conflicts = Array.isArray(generation.conflicts) ? generation.conflicts : [];
  const attempts = Array.isArray(generation.attempts) ? generation.attempts : [];
  const meta = $("#editorAiRunMeta");
  meta.innerHTML = [
    generation.provider ? `服务商：${escapeHtml(generation.provider)}` : "",
    generation.model ? `模型：${escapeHtml(generation.model)}` : "",
    `设定事实：${canonFactIds.length}`,
    `章节记忆：${memoryChapterIds.length}`,
    `自动重写：${Number(generation.rewriteCount || 0)} 次`,
    attempts.length ? `生成尝试：${attempts.length}` : ""
  ].filter(Boolean).map((item) => `<span>${item}</span>`).join("");
  meta.classList.remove("hidden");

  const contextDetails = $("#editorAiContextDetails");
  $("#editorAiContextList").innerHTML = `
    <div><strong>正式设定（${canonFactIds.length}）</strong>${canonFactIds.length ? escapeHtml(canonFactIds.join("、")) : "本次没有引用正式设定"}</div>
    <div><strong>已确认章节记忆（${memoryChapterIds.length}）</strong>${memoryChapterIds.length ? escapeHtml(memoryChapterIds.join("、")) : "本次没有引用此前章节记忆"}</div>`;
  contextDetails.classList.remove("hidden");

  const report = $("#editorAiValidationReport");
  const severityLabels = { hard: "硬冲突", soft: "软提醒" };
  const statusLabels = { open: "未解决", resolved: "已修复", dismissed: "已忽略" };
  report.classList.remove("hidden", "warning", "has-hard-conflict");
  if (!conflicts.length) {
    report.innerHTML = "<strong>一致性检查通过</strong><span>没有发现人物、事件、时间线或重复内容冲突。</span>";
    return;
  }
  const hasHardConflict = conflicts.some((conflict) => conflict.severity === "hard" && conflict.status === "open");
  report.classList.add(hasHardConflict || !canAccept ? "has-hard-conflict" : "warning");
  report.innerHTML = `<strong>一致性检查：${conflicts.length} 项</strong>${conflicts.map((conflict) => {
    const evidence = Array.isArray(conflict.evidence) ? conflict.evidence.filter((item) => item?.excerpt).map((item) => item.excerpt).join("；") : "";
    return `<div class="validation-item"><b>${escapeHtml(({ contradiction: "明确矛盾", confirmation: "待确认", suggestion: "写作建议" })[conflict.kind] || severityLabels[conflict.severity] || "提醒")} · ${escapeHtml(statusLabels[conflict.status] || conflict.status || "未解决")}</b><div>${escapeHtml(conflict.message || "发现潜在连续性问题")}</div>${evidence ? `<small>依据：${escapeHtml(evidence)}</small>` : ""}${conflict.status === "open" ? `<button type="button" class="quiet-button" data-adjudicate="${escapeHtml(conflict.id)}">标记误判</button>` : ""}</div>`;
  }).join("")}`;
}

function buildAcceptedRichContent(result) {
  const { index, length } = result.range;
  const generated = String(result.text || "").trim();
  const chapterText = state.quill.getText().trim();
  const selectedText = length ? state.quill.getText(index, length).trim() : "";
  if (!generated) throw new Error("生成结果为空，没有修改正文。");
  if ((!length && chapterText.includes(generated)) || (length && selectedText === generated)) {
    throw new Error(length ? "生成结果与选中文字相同，未重复替换。" : "这段内容已经在正文中，未重复插入。");
  }
  const prefix = !length && index > 0 && chapterText ? "\n\n" : "";
  const Delta = window.Quill.import("delta");
  const update = new Delta().retain(index);
  if (length) update.delete(length);
  update.insert(`${prefix}${generated}`);
  return { version: 1, ops: state.quill.getContents().compose(update).ops };
}

async function acceptAiEdit() {
  if (state.aiAccepting) return;
  const result = state.aiEditResult;
  if (!result || !state.quill) return;
  if (result.workId !== state.work?.id || result.chapterId !== currentChapter()?.id || result.editorRevision !== state.editorRevision || state.editorDirty) {
    invalidateAiEditResult();
    return showToast("正文或章节已经变化，请重新生成预览。");
  }
  if (!result.canAccept) {
    showToast("这次生成仍有未解决的硬冲突，请先重新生成。");
    return;
  }
  if (!result.generationId) {
    showToast("缺少生成记录，不能写入正文，请重新生成。");
    return;
  }
  let richContent;
  try {
    richContent = buildAcceptedRichContent(result);
  } catch (error) {
    showToast(error.message);
    return;
  }
  const acceptButton = $("[data-accept-ai-edit]");
  if (acceptButton) {
    acceptButton.disabled = true;
    acceptButton.textContent = "正在写入…";
  }
  state.aiAccepting = true;
  state.quill.enable(false);
  $("#chapterTitleInput").disabled = true;
  try {
    const payload = await request(`/api/works/${encodeURIComponent(result.workId)}/chapters/${encodeURIComponent(result.chapterId)}/generations/${encodeURIComponent(result.generationId)}/merge`, {
      method: "POST",
      body: JSON.stringify({ baseRevision: currentChapter().revision, hunkIds: $$('input[name="accepted-hunk"]:checked').map(input => input.value) })
    });
    const chapter = payload.chapter;
    if (!chapter) throw new Error("正文已提交，但没有收到更新后的章节。");
    const chapterIndex = state.work.chapters.findIndex((item) => item.id === chapter.id);
    if (chapterIndex >= 0) state.work.chapters[chapterIndex] = chapter;
    state.aiEditResult = null;
    clearEditorAiDiagnostics();
    loadChapterIntoEditor();
    renderChapters();
    renderHeader();
    $("#editorAiBody").innerHTML = "<p>正文已经写入。你可以继续输入新的指令。</p>";
    showToast("正文已写入并保存");
    if (payload.canonProposal) {
      state.work.canonProposals = [...(state.work.canonProposals || []).filter((item) => item.id !== payload.canonProposal.id), payload.canonProposal];
      renderLibrary();
      openCanonProposal(payload.canonProposal);
    }
    else showToast(payload.message || "正文已写入，可在正式设定中审校并刷新章节事实。", payload.reviewTask ? "查看任务" : "刷新事实", () => showBeta(payload.reviewTask ? "usage" : "facts"));
  } catch (error) {
    showToast(error.message);
    if (acceptButton) {
      acceptButton.disabled = false;
      acceptButton.textContent = result.range.length ? "替换选中内容" : "插入正文";
    }
  } finally {
    state.aiAccepting = false;
    state.quill.enable(Boolean(currentChapter()));
    $("#chapterTitleInput").disabled = !currentChapter();
  }
}

function renderLibrary() {
  const artifact = ARTIFACTS[state.activeArtifact];
  $("#libraryNav").innerHTML = Object.entries(ARTIFACTS).map(([type, item]) => `
    <button class="library-nav-row ${type === state.activeArtifact ? "active" : ""}" type="button" data-library-type="${type}"><span>${item.index}</span>${item.title}</button>
  `).join("");
  $("#libraryIndex").textContent = artifact.index;
  $("#libraryTitle").textContent = artifact.title;
  $("#libraryIntro").textContent = artifact.intro;
  const bible = state.work?.storyBible || {};
  const fields = Object.entries(artifact.fields).map(([field, label]) => state.libraryEditing
    ? `<div class="library-field"><label for="library-${field}">${label}</label><textarea id="library-${field}" data-library-field="${field}" placeholder="还没有内容…">${escapeHtml(bible[field] || "")}</textarea></div>`
    : `<section class="library-section"><h3>${escapeHtml(label)}</h3><p data-library-display="${field}">${bible[field] ? escapeHtml(bible[field]).replace(/\n/g, "<br>") : "还没有内容。"}</p></section>`
  ).join("");
  const history = state.proposals.filter((proposal) => proposal.type === state.activeArtifact && proposal.status !== "discarded").slice(0, 5);
  const historyHtml = history.length ? `<section class="library-field"><label>草案记录</label>${history.map((proposal) => `<button class="quiet-button" type="button" data-open-proposal="${escapeHtml(proposal.id)}">${formatDate(proposal.createdAt)} · ${proposal.status === "pending" ? "待确认" : proposal.status === "applied" ? "已写入" : "已撤销"}</button>`).join(" ")}</section>` : "";
  const pendingCanon = (state.work?.canonProposals || []).filter((proposal) => proposal.status === "pending");
  const canonHtml = pendingCanon.length ? `<section class="library-field"><label>待确认的事实提案</label>${pendingCanon.map((proposal) => `<button class="quiet-button" type="button" data-open-canon-proposal="${escapeHtml(proposal.id)}">${formatDate(proposal.createdAt)} · 查看并确认事实</button>`).join(" ")}</section>` : "";
  $("#libraryFields").innerHTML = fields + canonHtml + historyHtml;
  $("#editLibraryButton").classList.toggle("hidden", state.libraryEditing);
  $("#saveLibraryButton").classList.toggle("hidden", !state.libraryEditing);
  $("#editLibraryButton").disabled = !state.work;
  $("#saveLibraryButton").disabled = !state.work;
  $("#libraryAiButton").disabled = !state.work;
}

async function saveLibrary() {
  if (!state.work) return;
  const storyBible = { ...state.work.storyBible };
  $$('[data-library-field]').forEach((textarea) => { storyBible[textarea.dataset.libraryField] = textarea.value; });
  try {
    const payload = await request(`/api/works/${encodeURIComponent(state.work.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ storyBible })
    });
    state.work = payload.work;
    state.libraryEditing = false;
    renderLibrary();
    renderArtifactCards();
    showToast("创作资料已保存");
  } catch (error) {
    showToast(error.message);
  }
}

async function createChat() {
  if (!state.work) {
    openDialog("newWorkDialog");
    return;
  }
  const payload = await request(`/api/works/${encodeURIComponent(state.work.id)}/chats`, { method: "POST", body: "{}" });
  state.chats.unshift(payload.chat);
  state.activeChatId = payload.activeChatId;
  renderChats();
  renderConversation();
  $("#chatInput").focus();
}

async function refreshChats() {
  if (!state.work) return;
  const payload = await request(`/api/works/${encodeURIComponent(state.work.id)}/chats`);
  state.chats = payload.chats || [];
  state.proposals = payload.proposals || [];
  state.activeChatId = payload.activeChatId || state.activeChatId;
  renderChats();
  renderConversation();
  renderArtifactCards();
  renderLibrary();
}

function parseSseBlock(block) {
  let event = "message";
  const data = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trim());
  }
  if (!data.length) return null;
  return { event, payload: JSON.parse(data.join("\n")) };
}

async function sendChat(content, retryOf = "") {
  const text = String(content || "").trim();
  const chat = activeChat();
  if (!text || !state.work || !chat || state.chatAbortController) return;
  if (!await ensureAiAvailable()) return;
  $("#chatInput").value = "";
  resizeChatInput();
  const userMessage = { id: `temp-user-${Date.now()}`, role: "user", content: text, status: "complete", createdAt: new Date().toISOString() };
  const assistantMessage = { id: `temp-ai-${Date.now()}`, role: "assistant", content: "", status: "complete", createdAt: new Date().toISOString(), streaming: true };
  chat.messages.push(userMessage, assistantMessage);
  renderConversation();
  $("#sendChatButton").classList.add("hidden");
  $("#stopChatButton").classList.remove("hidden");
  state.chatAbortController = new AbortController();
  try {
    const response = await fetch(`/api/works/${encodeURIComponent(state.work.id)}/chats/${encodeURIComponent(chat.id)}/messages/stream`, {
      method: "POST",
      signal: state.chatAbortController.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text, retryOf })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const error = new Error(describeServerError(payload.error, "AI 请求失败"));
      error.status = response.status;
      throw error;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = done ? "" : blocks.pop() || "";
      for (const block of blocks) {
        const parsed = parseSseBlock(block);
        if (!parsed) continue;
        if (parsed.event === "meta") {
          assistantMessage.id = parsed.payload.assistantMessageId;
          chat.title = parsed.payload.chatTitle || chat.title;
          renderChats();
        }
        if (parsed.event === "delta") {
          assistantMessage.content += parsed.payload.text || "";
          const body = $(`[data-message-id="${CSS.escape(assistantMessage.id)}"] .message-body`);
          if (body) body.textContent = assistantMessage.content;
          else renderConversation();
          $("#conversation").scrollTop = $("#conversation").scrollHeight;
        }
        if (parsed.event === "error") {
          assistantMessage.status = "interrupted";
          if (parsed.payload.status === 499) {
            if (!assistantMessage.content) assistantMessage.content = "生成已停止。";
            continue;
          }
          const error = new Error(describeServerError(parsed.payload, "AI 请求失败"));
          error.status = parsed.payload.status || 502;
          const message = handleAiFailure(error);
          if (!assistantMessage.content) assistantMessage.content = message;
        }
        if (parsed.event === "done" && parsed.payload.warning) {
          showToast(parsed.payload.warning);
        }
      }
      if (done) break;
    }
  } catch (error) {
    assistantMessage.status = "interrupted";
    if (error.name === "AbortError") {
      if (!assistantMessage.content) assistantMessage.content = "生成已停止。";
    } else {
      const message = handleAiFailure(error);
      if (!assistantMessage.content) assistantMessage.content = message;
    }
  } finally {
    state.chatAbortController = null;
    $("#sendChatButton").classList.remove("hidden");
    $("#stopChatButton").classList.add("hidden");
    await refreshChats().catch(() => renderConversation());
  }
}

async function generateArtifact(type) {
  if (!state.work) {
    openDialog("newWorkDialog");
    return;
  }
  const chat = activeChat();
  if (!chat) return;
  if (!await ensureAiAvailable()) return;
  const artifact = ARTIFACTS[type];
  showToast(`正在整理${artifact.title}草案…`);
  try {
    const payload = await request(`/api/works/${encodeURIComponent(state.work.id)}/chats/${encodeURIComponent(chat.id)}/proposals`, {
      method: "POST",
      body: JSON.stringify({ type })
    });
    state.proposals.unshift(payload.proposal);
    renderConversation();
    renderLibrary();
    openProposal(payload.proposal.id);
  } catch (error) {
    handleAiFailure(error);
  }
}

function openProposal(proposalId) {
  const proposal = state.proposals.find((item) => item.id === proposalId);
  if (!proposal) return;
  state.activeProposalId = proposal.id;
  const editable = ["pending", "reverted"].includes(proposal.status);
  const appliedKeys = new Set(Object.keys(proposal.previousValues || {}));
  const descriptions = {
    pending: "选择要写入作品的部分。未选中的内容保持不变。",
    reverted: "上次写入已撤销，可以重新选择要写入的部分。",
    applied: "这份草案已经写入。下面勾选的是本次实际写入的部分。",
    discarded: "这份草案已经放弃，现在仅供查看。"
  };
  $("#proposalDialogTitle").textContent = `${ARTIFACTS[proposal.type]?.title || "创作资料"}草案`;
  $("#proposalForm header p").textContent = descriptions[proposal.status] || "这份草案现在仅供查看。";
  $("#proposalSections").innerHTML = proposal.sections.map((section) => `
    <label class="proposal-section${editable ? "" : " readonly"}">
      <input type="checkbox" name="proposal-section" value="${escapeHtml(section.key)}" ${editable || appliedKeys.has(section.key) ? "checked" : ""} ${editable ? "" : 'data-readonly="true" tabindex="-1"'}>
      <span><strong>${escapeHtml(section.label)}</strong><p>${escapeHtml(section.after)}</p></span>
    </label>`).join("");
  $("#discardProposalButton").classList.toggle("hidden", proposal.status !== "pending");
  updateProposalSubmitState();
  openDialog("proposalDialog");
}

function updateProposalSubmitState() {
  const proposal = state.proposals.find((item) => item.id === state.activeProposalId);
  const submit = $("#proposalForm").querySelector('[type="submit"]');
  if (!proposal || !submit) return;
  const editable = ["pending", "reverted"].includes(proposal.status);
  const checkedCount = $$('input[name="proposal-section"]:checked', $("#proposalForm")).length;
  const settledLabels = { applied: "已写入", discarded: "已放弃" };
  submit.disabled = editable && checkedCount === 0;
  submit.textContent = editable
    ? (checkedCount ? `确认写入 (${checkedCount})` : "请先选择内容")
    : (settledLabels[proposal.status] || "查看状态");
}

async function applyProposal(proposalId, sectionKeys = null) {
  const proposal = state.proposals.find((item) => item.id === proposalId);
  if (!proposal || !state.work) return;
  try {
    const payload = await request(`/api/works/${encodeURIComponent(state.work.id)}/proposals/${encodeURIComponent(proposal.id)}/apply`, {
      method: "POST",
      body: JSON.stringify({ sectionKeys })
    });
    Object.assign(proposal, payload.proposal);
    state.work.storyBible = payload.storyBible;
    closeDialog("proposalDialog");
    renderConversation();
    renderArtifactCards();
    renderLibrary();
    showToast("草案已写入创作资料", "撤销", () => revertProposal(proposal.id));
  } catch (error) {
    showToast(error.message);
  }
}

async function revertProposal(proposalId) {
  const proposal = state.proposals.find((item) => item.id === proposalId);
  if (!proposal || !state.work) return;
  const payload = await request(`/api/works/${encodeURIComponent(state.work.id)}/proposals/${encodeURIComponent(proposal.id)}/revert`, { method: "POST", body: "{}" });
  Object.assign(proposal, payload.proposal);
  state.work.storyBible = payload.storyBible;
  renderConversation();
  renderArtifactCards();
  renderLibrary();
  showToast("已撤销本次写入");
}

async function discardProposal(proposalId) {
  const proposal = state.proposals.find((item) => item.id === proposalId);
  if (!proposal || !state.work) return;
  const payload = await request(`/api/works/${encodeURIComponent(state.work.id)}/proposals/${encodeURIComponent(proposal.id)}`, { method: "PATCH", body: JSON.stringify({ status: "discarded" }) });
  Object.assign(proposal, payload.proposal);
  closeDialog("proposalDialog");
  renderConversation();
  renderLibrary();
  showToast("已放弃草案");
}

function openCanonProposal(proposal) {
  const additions = Array.isArray(proposal?.changes)
    ? proposal.changes.filter((change) => change?.operation === "add" && change.fact?.id)
    : [];
  state.activeCanonProposal = proposal;
  const categoryLabels = {
    identity: "身份", life_status: "生死状态", ability: "能力", knowledge: "已知信息",
    relationship: "人物关系", timeline: "时间线", world_rule: "世界规则", location: "地点",
    event_state: "事件状态", foreshadowing: "伏笔", other: "其他"
  };
  $("#canonProposalSections").innerHTML = additions.map(({ fact }) => `
    <label class="proposal-section">
      <input type="checkbox" name="canon-proposal-fact" value="${escapeHtml(fact.id)}" checked>
      <span><strong>${escapeHtml(fact.predicate || "新增事实")}</strong><p>${escapeHtml(fact.value || fact.objectId || "")}</p>${fact.subjectId ? `<small>对象：${escapeHtml(fact.subjectId)}</small>` : ""}</span>
      <span class="canon-proposal-type">${escapeHtml(categoryLabels[fact.category] || "事实")}</span>
    </label>`).join("");
  const summary = $("#canonProposalSummary");
  summary.textContent = additions.length
    ? `AI 从本章提取了 ${additions.length} 条新增事实。只有你勾选确认的内容才会成为后续写作约束。`
    : "正文已保存，但这次没有可确认的新增事实。";
  summary.classList.remove("hidden");
  updateCanonProposalSubmitState();
  openDialog("canonProposalDialog");
}

function updateCanonProposalSubmitState() {
  const checkedCount = $$('input[name="canon-proposal-fact"]:checked', $("#canonProposalForm")).length;
  const submit = $("#confirmCanonProposalButton");
  if (!submit) return;
  submit.disabled = checkedCount === 0;
  submit.textContent = checkedCount ? `确认更新设定 (${checkedCount})` : "请先选择事实";
}

async function confirmCanonProposal() {
  const proposal = state.activeCanonProposal;
  if (!state.work || !proposal?.id) {
    showToast("事实提案状态已变化，请重新打开后再试。");
    return;
  }
  const factIds = $$('input[name="canon-proposal-fact"]:checked', $("#canonProposalForm")).map((input) => input.value);
  if (!factIds.length) {
    showToast("请至少选择一条要加入正式设定的事实。");
    updateCanonProposalSubmitState();
    return;
  }
  const submit = $("#confirmCanonProposalButton");
  submit.disabled = true;
  submit.textContent = "正在更新…";
  try {
    const payload = await request(`/api/works/${encodeURIComponent(state.work.id)}/canon-proposals/${encodeURIComponent(proposal.id)}/confirm`, {
      method: "POST",
      body: JSON.stringify({ factIds })
    });
    if (payload.canon) state.work.canon = payload.canon;
    state.work.canonProposals = (state.work.canonProposals || []).filter((item) => item.id !== proposal.id);
    renderLibrary();
    state.activeCanonProposal = null;
    closeDialog("canonProposalDialog");
    showToast(`已将 ${factIds.length} 条事实加入正式设定。`);
  } catch (error) {
    showToast(error.message);
    updateCanonProposalSubmitState();
  }
}

async function rejectCanonProposal() {
  const proposal = state.activeCanonProposal;
  if (!state.work || !proposal?.id) {
    showToast("事实提案状态已变化，请重新打开后再试。");
    return;
  }
  const button = $("#rejectCanonProposalButton");
  button.disabled = true;
  try {
    await request(`/api/works/${encodeURIComponent(state.work.id)}/canon-proposals/${encodeURIComponent(proposal.id)}/reject`, { method: "POST", body: "{}" });
    state.work.canonProposals = (state.work.canonProposals || []).filter((item) => item.id !== proposal.id);
    renderLibrary();
    state.activeCanonProposal = null;
    closeDialog("canonProposalDialog");
    showToast("已保留正文，不更新正式设定。");
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
}

function normalizeProviderStatuses(config) {
  const raw = config.providerStatuses;
  const source = Array.isArray(raw)
    ? Object.fromEntries(raw.map((item) => [item.provider || item.value, item]).filter(([provider]) => provider))
    : (raw && typeof raw === "object" ? raw : {});
  return Object.fromEntries((config.providers || []).map((provider) => {
    const current = source[provider.value] || {};
    const isActive = provider.value === config.provider;
    return [provider.value, {
      provider: provider.value,
      label: current.label || provider.label,
      hasApiKey: Boolean(current.hasApiKey ?? (isActive && config.hasApiKey)),
      status: current.status || (current.available === true ? "available" : current.available === false ? "unavailable" : "unknown"),
      message: current.code ? describeServerError(current) : current.message || "",
      model: current.model || (isActive ? config.model : ""),
      checkedAt: current.checkedAt || ""
    }];
  }));
}

function renderProviderStatuses(activeProvider) {
  const list = $("#aiProviderStatusList");
  if (!list) return;
  const statuses = Object.values(state.aiProviderStatuses);
  list.innerHTML = statuses.map((status) => {
    const stateClass = status.status === "available" ? "available" : status.status === "unavailable" ? "unavailable" : "";
    const description = status.hasApiKey
      ? (status.message || (status.status === "unknown" ? "运行环境已配置，等待检测" : status.status === "available" ? "接口可用" : "接口不可用"))
      : "运行环境未配置";
    const model = status.model || (status.hasApiKey ? "自动选择模型" : "未配置");
    return `<article class="ai-provider-status ${stateClass} ${status.provider === activeProvider ? "active" : ""}" data-ai-provider-status="${escapeHtml(status.provider)}">
      <span class="provider-status-dot" aria-hidden="true"></span>
      <div><strong>${escapeHtml(status.label)}</strong><small>${escapeHtml(description)}</small></div>
      <span class="provider-model">${status.provider === activeProvider ? "当前 · " : ""}${escapeHtml(model)}</span>
    </article>`;
  }).join("");
  list.classList.toggle("hidden", statuses.length === 0);
}

function applySettingsConfig(config, availableModels = []) {
  const modelSelect = $("#aiModelInput");
  const selectedValue = `${config.provider}::${config.model}`;
  modelSelect.innerHTML = availableModels.length
    ? availableModels.map((model) => `<option value="${escapeHtml(`${model.provider}::${model.id}`)}">${escapeHtml(`${model.providerLabel} · ${model.id}`)}</option>`).join("")
    : '<option value="">暂无可用模型</option>';
  if (availableModels.some((model) => `${model.provider}::${model.id}` === selectedValue)) modelSelect.value = selectedValue;
  modelSelect.disabled = availableModels.length === 0;
  state.aiProviderStatuses = normalizeProviderStatuses(config);
  $("#settingsStatus").textContent = availableModels.length
    ? `当前选择：${modelSelect.options[modelSelect.selectedIndex]?.textContent || ""}`
    : "运行环境尚未配置可用的 AI 服务，请联系应用管理员。";
  renderProviderStatuses(config.provider);
}

async function loadSettings() {
  const [{ config }, modelPayload] = await Promise.all([request("/api/ai/config"), request("/api/ai/models")]);
  applySettingsConfig(config, modelPayload.models || []);
}

async function saveSettings() {
  const selected = $("#aiModelInput").value;
  if (!selected) throw new Error("当前没有可选择的 AI 模型。");
  const [provider, ...modelParts] = selected.split("::");
  const body = { provider, model: modelParts.join("::") };
  const { config } = await request("/api/ai/config", { method: "POST", body: JSON.stringify(body) });
  applySettingsConfig(config);
  const available = await checkAiAvailability();
  await loadSettings();
  $("#settingsStatus").textContent = state.aiAvailability.message;
  if (available) {
    closeDialog("settingsDialog");
    showToast(`${config.providerLabel} 已连接`);
  }
}

function resizeChatInput() {
  const input = $("#chatInput");
  input.style.height = "auto";
  input.style.height = `${Math.min(180, input.scrollHeight)}px`;
  syncChatSubmitState();
}

function syncChatSubmitState() {
  const sendButton = $("#sendChatButton");
  if (!sendButton) return;
  sendButton.disabled = !state.work
    || !activeChat()
    || !$("#chatInput").value.trim()
    || Boolean(state.chatAbortController);
}

function bindEvents() {
  document.addEventListener("click", async (event) => {
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) {
      updateView(viewButton.dataset.view);
      closeMenus();
    }

    if (event.target.closest("[data-open-project-menu]")) {
      event.stopPropagation();
      const menu = $("#projectMenu");
      const open = !menu.classList.contains("open");
      closeMenus();
      menu.classList.toggle("open", open);
      menu.setAttribute("aria-hidden", String(!open));
      $$('[data-open-project-menu]').forEach((button) => button.setAttribute("aria-expanded", String(open)));
      return;
    }
    if (!event.target.closest("#projectMenu")) closeMenus();

    if (event.target.closest("[data-open-ai-settings]")) {
      await loadSettings();
      openDialog("settingsDialog");
    }

    const promptButton = event.target.closest("[data-chat-prompt]");
    if (promptButton) {
      $("#chatInput").value = promptButton.dataset.chatPrompt;
      resizeChatInput();
      $("#chatInput").focus();
    }
    if (event.target.closest("[data-create-first-work]")) openDialog("newWorkDialog");

    const workButton = event.target.closest("[data-switch-work]");
    if (workButton) await loadWork(workButton.dataset.switchWork);

    const chatButton = event.target.closest("[data-select-chat]");
    if (chatButton) {
      state.activeChatId = chatButton.dataset.selectChat;
      renderChats();
      renderConversation();
      $("#chatHistoryPanel").classList.remove("open");
    }

    const chatMenu = event.target.closest("[data-chat-menu]");
    if (chatMenu) {
      const chat = state.chats.find((item) => item.id === chatMenu.dataset.chatMenu);
      if (!chat) return;
      const action = prompt(`输入新标题；输入 DELETE 删除这段对话。\n当前标题：${chat.title}`, chat.title);
      if (action === null) return;
      if (action.trim().toUpperCase() === "DELETE") {
        if (!confirm("删除这段对话？已保存的创作资料不会被删除。")) return;
        const payload = await request(`/api/works/${state.work.id}/chats/${chat.id}`, { method: "DELETE" });
        state.chats = payload.chats;
        state.activeChatId = payload.activeChatId;
      } else if (action.trim()) {
        const payload = await request(`/api/works/${state.work.id}/chats/${chat.id}`, { method: "PATCH", body: JSON.stringify({ title: action }) });
        Object.assign(chat, payload.chat);
        state.activeChatId = chat.id;
      }
      renderChats();
      renderConversation();
    }

    const artifactButton = event.target.closest("[data-generate-artifact]");
    if (artifactButton) {
      event.stopPropagation();
      await generateArtifact(artifactButton.dataset.generateArtifact);
    }
    const libraryCard = event.target.closest("[data-open-library]");
    if (libraryCard && !event.target.closest("[data-generate-artifact]")) {
      state.activeArtifact = libraryCard.dataset.openLibrary;
      state.libraryEditing = false;
      renderLibrary();
      updateView("library");
    }
    const libraryType = event.target.closest("[data-library-type]");
    if (libraryType) {
      state.activeArtifact = libraryType.dataset.libraryType;
      state.libraryEditing = false;
      renderLibrary();
    }

    const chapterButton = event.target.closest("[data-chapter-id]");
    if (chapterButton) {
      if (state.aiAccepting) return showToast("正在写入正文，请稍候再切换章节。");
      await saveChapterNow();
      state.currentChapterId = chapterButton.dataset.chapterId;
      renderChapters();
      loadChapterIntoEditor();
    }

    const aiEditButton = event.target.closest("[data-ai-edit]");
    if (aiEditButton) openEditorAi(aiEditButton.dataset.aiEdit);
    if (event.target.closest("[data-accept-ai-edit]")) await acceptAiEdit();
    if (event.target.closest("[data-regenerate-ai-edit]")) $("#editorAiForm").requestSubmit();
    if (event.target.closest("[data-reject-ai-edit]")) {
      state.aiEditResult = null;
      clearEditorAiDiagnostics();
      $("#editorAiBody").innerHTML = "<p>预览已清除。修改上方指令后可以重新生成。</p>";
    }

    const canonButton = event.target.closest("[data-open-canon-proposal]");
    if (canonButton) {
      const proposal = state.work?.canonProposals?.find((item) => item.id === canonButton.dataset.openCanonProposal);
      if (proposal) openCanonProposal(proposal);
    }
    const openProposalButton = event.target.closest("[data-open-proposal]");
    if (openProposalButton) openProposal(openProposalButton.dataset.openProposal);
    const applyButton = event.target.closest("[data-apply-proposal]");
    if (applyButton) await applyProposal(applyButton.dataset.applyProposal);
    const revertButton = event.target.closest("[data-revert-proposal]");
    if (revertButton) await revertProposal(revertButton.dataset.revertProposal);
    const retryButton = event.target.closest("[data-retry-message]");
    if (retryButton) {
      const chat = activeChat();
      const index = chat.messages.findIndex((message) => message.id === retryButton.dataset.retryMessage);
      const user = [...chat.messages.slice(0, index)].reverse().find((message) => message.role === "user");
      if (user) await sendChat(user.content, retryButton.dataset.retryMessage);
    }

    const closeButton = event.target.closest("[data-close-dialog]");
    if (closeButton) closeDialog(closeButton.dataset.closeDialog);
  });

  $("#chatComposer").addEventListener("submit", async (event) => {
    event.preventDefault();
    await sendChat($("#chatInput").value);
  });
  $("#chatInput").addEventListener("input", resizeChatInput);
  $("#chatInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      $("#chatComposer").requestSubmit();
    }
  });
  $("#stopChatButton").addEventListener("click", () => state.chatAbortController?.abort());
  $("#newChatButton").addEventListener("click", createChat);
  $("#newChatInsideButton").addEventListener("click", createChat);
  $("#chatHistoryButton").addEventListener("click", () => {
    $("#chatHistoryPanel").classList.add("open");
    $("#chatHistoryPanel").setAttribute("aria-hidden", "false");
  });
  $('[data-close-history]').addEventListener("click", () => {
    $("#chatHistoryPanel").classList.remove("open");
    $("#chatHistoryPanel").setAttribute("aria-hidden", "true");
  });

  $("#mobilePanelButton").addEventListener("click", () => {
    const activeScreen = $(`[data-screen="${state.currentView}"]`);
    activeScreen?.classList.toggle("panel-open");
    if (activeScreen?.classList.contains("editor-screen") && activeScreen.classList.contains("panel-open")) {
      activeScreen.classList.remove("ai-panel-open");
      $("#editorAiPanel").setAttribute("aria-hidden", "true");
    }
  });
  $("#addChapterButton").addEventListener("click", addChapter);
  $("#chapterTitleInput").addEventListener("input", () => {
    invalidateAiEditResult();
    state.editorDirty = true;
    scheduleChapterSave();
  });
  $("#toggleEditorAiButton").addEventListener("click", () => {
    openEditorAi();
  });
  $('[data-close-editor-ai]').addEventListener("click", () => {
    $(".editor-screen").classList.remove("ai-panel-open");
    $("#editorAiPanel").setAttribute("aria-hidden", "true");
  });
  $("#editorAiForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await generateEditorAiDraft();
  });

  $("#saveLibraryButton").addEventListener("click", saveLibrary);
  $("#editLibraryButton").addEventListener("click", () => {
    state.libraryEditing = true;
    renderLibrary();
  });
  $("#libraryAiButton").addEventListener("click", () => generateArtifact(state.activeArtifact));

  $("#newWorkMenuButton").addEventListener("click", () => openDialog("newWorkDialog"));
  $("#newWorkForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = await request("/api/works", {
      method: "POST",
      body: JSON.stringify({ title: $("#newWorkTitle").value, premise: $("#newWorkPremise").value })
    });
    closeDialog("newWorkDialog");
    $("#newWorkForm").reset();
    await loadWorks(payload.work.id);
    updateView("ai");
    $("#chatInput").focus();
  });

  $("#projectInfoButton").addEventListener("click", () => {
    if (!state.work) return;
    $("#projectTitleInput").value = state.work.title || "";
    $("#projectGenreInput").value = state.work.genre || "";
    $("#projectPremiseInput").value = state.work.premise || "";
    openDialog("projectInfoDialog");
  });
  $("#projectInfoForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = await request(`/api/works/${encodeURIComponent(state.work.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ title: $("#projectTitleInput").value, genre: $("#projectGenreInput").value, premise: $("#projectPremiseInput").value })
    });
    state.work = payload.work;
    closeDialog("projectInfoDialog");
    await loadWorks(state.work.id);
    showToast("作品信息已保存");
  });
  $("#deleteWorkButton").addEventListener("click", async () => {
    if (!state.work || !confirm(`确定删除《${state.work.title}》？此操作无法撤销。`)) return;
    await request(`/api/works/${encodeURIComponent(state.work.id)}`, { method: "DELETE" });
    localStorage.removeItem("motai-current-work");
    await loadWorks();
    showToast("作品已删除");
  });
  $("#exportButton").addEventListener("click", () => {
    if (state.work) window.location.href = `/api/works/${encodeURIComponent(state.work.id)}/export?format=${encodeURIComponent($("#exportFormat").value)}`;
  });

  $("#settingsButton").addEventListener("click", async () => {
    await loadSettings();
    openDialog("settingsDialog");
  });
  $("#aiAvailabilityButton").addEventListener("click", async () => {
    await loadSettings();
    openDialog("settingsDialog");
  });
  $("#settingsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try { await saveSettings(); } catch (error) { $("#settingsStatus").textContent = error.message; }
  });
  $("#aiModelInput").addEventListener("change", () => {
    const select = $("#aiModelInput");
    $("#settingsStatus").textContent = `将使用：${select.options[select.selectedIndex]?.textContent || ""}`;
  });
  $("#proposalForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const proposal = state.proposals.find((item) => item.id === state.activeProposalId);
    if (!proposal || !state.work) {
      showToast("草案状态已变化，请重新打开后再试。");
      return;
    }
    if (proposal.status === "applied") {
      showToast("这份草案已经写入，无需重复操作。");
      return;
    }
    if (proposal.status === "discarded") {
      showToast("这份草案已经放弃，不能再写入。");
      return;
    }
    const keys = $$('input[name="proposal-section"]:checked', $("#proposalForm")).map((input) => input.value);
    if (!keys.length) {
      showToast("请至少选择一个要写入的部分。");
      updateProposalSubmitState();
      return;
    }
    await applyProposal(state.activeProposalId, keys);
  });
  $("#proposalForm").addEventListener("change", (event) => {
    if (event.target.matches('input[name="proposal-section"]')) updateProposalSubmitState();
  });
  $("#proposalSections").addEventListener("click", (event) => {
    if (!event.target.closest(".proposal-section.readonly")) return;
    event.preventDefault();
    const proposal = state.proposals.find((item) => item.id === state.activeProposalId);
    if (proposal?.status === "applied") showToast("这部分已经写入，不能重复选择。");
    else if (proposal?.status === "discarded") showToast("这份草案已经放弃，选项仅供查看。");
  });
  $("#discardProposalButton").addEventListener("click", () => discardProposal(state.activeProposalId));
  $("#canonProposalForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await confirmCanonProposal();
  });
  $("#canonProposalForm").addEventListener("change", (event) => {
    if (event.target.matches('input[name="canon-proposal-fact"]')) updateCanonProposalSubmitState();
  });
  $("#rejectCanonProposalButton").addEventListener("click", rejectCanonProposal);
  window.addEventListener("beforeunload", () => { if (state.editorDirty) saveChapterNow(); });
  window.addEventListener("resize", () => {
    const range = state.quill?.getSelection();
    if (range?.length) positionSelectionTools(range);
  });
}

async function init() {
  bindEvents();
  initQuill();
  renderAiAvailability();
  const availabilityCheck = checkAiAvailability();
  try {
    await loadWorks();
  } catch (error) {
    showToast(`加载失败：${error.message}`);
    $("#currentWorkTitle").textContent = "无法加载作品";
  }
  await availabilityCheck;
}

init();
