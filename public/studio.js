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

async function request(pathname, options = {}) {
  const response = await fetch(pathname, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `请求失败（${response.status}）`);
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
    ? `${state.work.genre || "原创"} · ${state.work.stats?.totalCharacters || 0} 字`
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
    return;
  }
  $("#chatInput").disabled = false;
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
  $("#chapterCountLabel").textContent = `${chapters.length} 个章节`;
  $("#chapterList").innerHTML = chapters.map((chapter, index) => `
    <button class="chapter-row ${chapter.id === state.currentChapterId ? "active" : ""}" type="button" data-chapter-id="${escapeHtml(chapter.id)}">
      <strong>${escapeHtml(chapter.title || `第${index + 1}章`)}</strong>
      <small>${countCharacters(chapter.content)} 字</small>
    </button>
  `).join("");
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
  const chapter = currentChapter();
  if (!state.quill || !chapter) {
    $("#chapterTitleInput").value = "";
    return;
  }
  clearTimeout(state.editorSaveTimer);
  state.suppressEditorEvents = true;
  const rich = chapter.richContent?.ops ? chapter.richContent : { ops: [{ insert: `${chapter.content || ""}\n` }] };
  state.quill.setContents(rich.ops, "silent");
  state.quill.history.clear();
  $("#chapterTitleInput").value = chapter.title || "";
  state.editorDirty = false;
  state.suppressEditorEvents = false;
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
  clearTimeout(state.editorSaveTimer);
  const work = state.work;
  const chapter = currentChapter();
  if (!work || !chapter || !state.quill || !state.editorDirty) return;
  const workId = work.id;
  const chapterId = chapter.id;
  const title = $("#chapterTitleInput").value.trim() || chapter.title || "未命名章节";
  const richContent = { version: 1, ops: state.quill.getContents().ops };
  setSaveState("saving", "保存中…");
  try {
    const payload = await request(`/api/works/${encodeURIComponent(workId)}/chapters/${encodeURIComponent(chapterId)}`, {
      method: "PATCH",
      body: JSON.stringify({ title, richContent })
    });
    if (state.work?.id === workId) {
      const index = state.work.chapters.findIndex((item) => item.id === chapterId);
      if (index >= 0) state.work.chapters[index] = payload.chapter;
      state.editorDirty = false;
      setSaveState("saved", "已保存");
      renderChapters();
      renderHeader();
    }
  } catch (error) {
    setSaveState("error", "保存失败");
    showToast(error.message);
  }
}

async function addChapter() {
  if (!state.work) return;
  await saveChapterNow();
  const payload = await request(`/api/works/${encodeURIComponent(state.work.id)}/chapters`, { method: "POST", body: "{}" });
  state.work = payload.work;
  state.currentChapterId = payload.chapter.id;
  renderChapters();
  loadChapterIntoEditor();
  showToast("已新建章节");
}

async function runAiEdit(mode) {
  const chapter = currentChapter();
  if (!state.work || !chapter || !state.quill) return;
  const range = state.editorSelection || state.quill.getSelection();
  const selectedText = range?.length ? state.quill.getText(range.index, range.length) : "";
  if (mode === "ask") {
    updateView("ai");
    $("#chatInput").value = `我想和你讨论这段正文：\n\n${selectedText}`;
    resizeChatInput();
    $("#chatInput").focus();
    return;
  }
  if (!["continue"].includes(mode) && !selectedText.trim()) {
    showToast("请先选中要处理的正文");
    return;
  }
  $("#selectionTools").classList.add("hidden");
  $(".editor-screen").classList.add("ai-panel-open");
  $("#editorAiPanel").setAttribute("aria-hidden", "false");
  $("#editorAiBody").innerHTML = "<p>AI 正在阅读选中的正文…</p>";
  try {
    const payload = await request("/api/ai/write", {
      method: "POST",
      body: JSON.stringify({ mode, selectedText, work: state.work, chapter })
    });
    state.aiEditResult = { mode, text: payload.text, range: range || { index: state.quill.getLength() - 1, length: 0 } };
    $("#editorAiBody").innerHTML = `
      <div class="ai-edit-result">${escapeHtml(payload.text)}</div>
      ${payload.warning ? `<p>${escapeHtml(payload.warning)}</p>` : ""}
      <div class="ai-edit-actions"><button class="quiet-button" type="button" data-reject-ai-edit>放弃</button><button class="primary-button" type="button" data-accept-ai-edit>接受修改</button></div>`;
  } catch (error) {
    $("#editorAiBody").innerHTML = `<p class="danger-text">${escapeHtml(error.message)}</p>`;
  }
}

function acceptAiEdit() {
  const result = state.aiEditResult;
  if (!result || !state.quill) return;
  const { index, length } = result.range;
  if (result.mode === "continue") {
    state.quill.insertText(index + length, `${length ? "\n" : ""}${result.text}`, "user");
  } else {
    state.quill.deleteText(index, length, "user");
    state.quill.insertText(index, result.text, "user");
  }
  state.quill.setSelection(index + result.text.length, 0, "silent");
  state.aiEditResult = null;
  $(".editor-screen").classList.remove("ai-panel-open");
  showToast("已应用 AI 修改", "撤销", async () => state.quill.history.undo());
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
  $("#libraryFields").innerHTML = fields + historyHtml;
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
      throw new Error(payload.error || "AI 请求失败");
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
          if (!assistantMessage.content) assistantMessage.content = parsed.payload.message || "生成失败";
          showToast(parsed.payload.message || "生成失败");
        }
        if (parsed.event === "done" && parsed.payload.warning) {
          showToast(parsed.payload.warning);
        }
      }
      if (done) break;
    }
  } catch (error) {
    assistantMessage.status = "interrupted";
    if (!assistantMessage.content) assistantMessage.content = error.name === "AbortError" ? "生成已停止。" : error.message;
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
    showToast(error.message);
  }
}

function openProposal(proposalId) {
  const proposal = state.proposals.find((item) => item.id === proposalId);
  if (!proposal) return;
  state.activeProposalId = proposal.id;
  $("#proposalDialogTitle").textContent = `${ARTIFACTS[proposal.type]?.title || "创作资料"}草案`;
  $("#proposalSections").innerHTML = proposal.sections.map((section) => `
    <label class="proposal-section">
      <input type="checkbox" name="proposal-section" value="${escapeHtml(section.key)}" ${proposal.status === "pending" || proposal.status === "reverted" ? "checked" : "disabled"}>
      <span><strong>${escapeHtml(section.label)}</strong><p>${escapeHtml(section.after)}</p></span>
    </label>`).join("");
  $("#proposalForm").querySelector('[type="submit"]').disabled = !["pending", "reverted"].includes(proposal.status);
  $("#discardProposalButton").classList.toggle("hidden", proposal.status !== "pending");
  openDialog("proposalDialog");
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

async function loadSettings() {
  const { config } = await request("/api/ai/config");
  const providerSelect = $("#aiProviderInput");
  providerSelect.innerHTML = config.providers.map((provider) => `<option value="${escapeHtml(provider.value)}">${escapeHtml(provider.label)}</option>`).join("");
  providerSelect.value = config.provider;
  providerSelect.dataset.presets = JSON.stringify(config.providers);
  $("#aiKeyInput").value = "";
  $("#aiKeyInput").placeholder = config.hasApiKey ? "已保存（留空不修改）" : "请输入 API Key";
  $("#aiModelInput").value = config.model || "";
  $("#aiBaseUrlInput").value = config.baseUrl || "";
  $("#aiEndpointInput").value = config.endpoint || "chat";
  $("#aiMaxTokensInput").value = config.maxOutputTokens || 3200;
  $("#aiTimeoutInput").value = config.timeoutMs || 30000;
  $("#aiProxyInput").value = config.proxy || "";
  $("#aiFallbackInput").checked = config.localFallback !== false;
  $("#imageBaseUrlInput").value = config.image?.baseUrl || "";
  $("#imageModelInput").value = config.image?.model || "";
  $("#modelMigrationWarning").classList.toggle("hidden", !config.modelDeprecated);
  $("#settingsStatus").textContent = config.configured ? `当前：${config.providerLabel} · ${config.model}` : "尚未配置外部模型，将使用本地备用。";
}

async function saveSettings() {
  const body = {
    provider: $("#aiProviderInput").value,
    apiKey: $("#aiKeyInput").value,
    model: $("#aiModelInput").value,
    baseUrl: $("#aiBaseUrlInput").value,
    endpoint: $("#aiEndpointInput").value,
    maxOutputTokens: Number($("#aiMaxTokensInput").value),
    timeoutMs: Number($("#aiTimeoutInput").value),
    proxy: $("#aiProxyInput").value,
    localFallback: $("#aiFallbackInput").checked,
    imageBaseUrl: $("#imageBaseUrlInput").value,
    imageModel: $("#imageModelInput").value
  };
  const { config } = await request("/api/ai/config", { method: "POST", body: JSON.stringify(body) });
  closeDialog("settingsDialog");
  showToast(`已保存 ${config.providerLabel} 设置`);
}

function resizeChatInput() {
  const input = $("#chatInput");
  input.style.height = "auto";
  input.style.height = `${Math.min(180, input.scrollHeight)}px`;
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
      await saveChapterNow();
      state.currentChapterId = chapterButton.dataset.chapterId;
      renderChapters();
      loadChapterIntoEditor();
    }

    const aiEditButton = event.target.closest("[data-ai-edit]");
    if (aiEditButton) await runAiEdit(aiEditButton.dataset.aiEdit);
    if (event.target.closest("[data-accept-ai-edit]")) acceptAiEdit();
    if (event.target.closest("[data-reject-ai-edit]")) {
      state.aiEditResult = null;
      $(".editor-screen").classList.remove("ai-panel-open");
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
  });
  $("#addChapterButton").addEventListener("click", addChapter);
  $("#chapterTitleInput").addEventListener("input", () => {
    state.editorDirty = true;
    scheduleChapterSave();
  });
  $("#toggleEditorAiButton").addEventListener("click", () => {
    const screen = $(".editor-screen");
    screen.classList.toggle("ai-panel-open");
    $("#editorAiPanel").setAttribute("aria-hidden", String(!screen.classList.contains("ai-panel-open")));
  });
  $('[data-close-editor-ai]').addEventListener("click", () => $(".editor-screen").classList.remove("ai-panel-open"));

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
  $("#settingsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try { await saveSettings(); } catch (error) { $("#settingsStatus").textContent = error.message; }
  });
  $("#testAiButton").addEventListener("click", async () => {
    $("#settingsStatus").textContent = "正在测试连接…";
    const result = await request("/api/ai/test", { method: "POST", body: "{}" });
    $("#settingsStatus").textContent = result.message;
  });
  $("#aiProviderInput").addEventListener("change", (event) => {
    const presets = JSON.parse(event.target.dataset.presets || "[]");
    const preset = presets.find((item) => item.value === event.target.value);
    if (!preset) return;
    $("#aiBaseUrlInput").value = preset.baseUrl || "";
    $("#aiModelInput").value = preset.model || "";
    $("#aiEndpointInput").value = preset.endpoint || "chat";
  });

  $("#proposalForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const keys = $$('input[name="proposal-section"]:checked', $("#proposalForm")).map((input) => input.value);
    await applyProposal(state.activeProposalId, keys);
  });
  $("#discardProposalButton").addEventListener("click", () => discardProposal(state.activeProposalId));
  window.addEventListener("beforeunload", () => { if (state.editorDirty) saveChapterNow(); });
  window.addEventListener("resize", () => {
    const range = state.quill?.getSelection();
    if (range?.length) positionSelectionTools(range);
  });
}

async function init() {
  bindEvents();
  initQuill();
  try {
    await loadWorks();
  } catch (error) {
    showToast(`加载失败：${error.message}`);
    $("#currentWorkTitle").textContent = "无法加载作品";
  }
}

init();
