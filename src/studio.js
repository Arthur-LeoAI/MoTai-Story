const { createId, normalizeText, nowIso, normalizeStoryBible } = require("./domain");

const CHAT_TITLE_LIMIT = 36;
const CHAT_CONTEXT_CHARACTER_LIMIT = 48000;

const ARTIFACT_DEFINITIONS = {
  outline: {
    label: "故事大纲",
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
    label: "人物关系",
    fields: {
      characters: "人物设定",
      relationships: "人物关系"
    }
  },
  world: {
    label: "世界观规则",
    fields: {
      worldview: "世界设定",
      rules: "世界规则",
      era: "时代背景",
      factions: "阵营势力",
      locations: "关键地点"
    }
  },
  timeline: {
    label: "关键事件时间线",
    fields: {
      keyEvents: "关键事件",
      foreshadowing: "伏笔与回收",
      continuityNotes: "连续性记录"
    }
  }
};

const ALLOWED_INLINE_ATTRIBUTES = new Set(["bold", "italic", "link"]);
const ALLOWED_LINE_ATTRIBUTES = new Set(["header", "blockquote", "list"]);
const ALLOWED_ATTRIBUTES = new Set([...ALLOWED_INLINE_ATTRIBUTES, ...ALLOWED_LINE_ATTRIBUTES]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeDate(value, fallback = nowIso()) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function normalizeMessage(value) {
  const source = isObject(value) ? value : {};
  const role = ["user", "assistant"].includes(source.role) ? source.role : "assistant";
  const status = ["complete", "interrupted"].includes(source.status) ? source.status : "complete";
  return {
    id: normalizeText(source.id) || createId("message"),
    role,
    content: String(source.content || "").slice(0, 200000),
    status,
    createdAt: normalizeDate(source.createdAt),
    ...(normalizeText(source.retryOf) ? { retryOf: normalizeText(source.retryOf) } : {})
  };
}

function normalizeChat(value) {
  const source = isObject(value) ? value : {};
  const createdAt = normalizeDate(source.createdAt);
  const messages = Array.isArray(source.messages) ? source.messages.map(normalizeMessage) : [];
  return {
    id: normalizeText(source.id) || createId("chat"),
    title: normalizeText(source.title).slice(0, CHAT_TITLE_LIMIT) || "新对话",
    createdAt,
    updatedAt: normalizeDate(source.updatedAt, createdAt),
    messages
  };
}

function normalizeProposal(value) {
  const source = isObject(value) ? value : {};
  const type = Object.hasOwn(ARTIFACT_DEFINITIONS, source.type) ? source.type : "outline";
  const definition = ARTIFACT_DEFINITIONS[type];
  const sections = Array.isArray(source.sections)
    ? source.sections
      .filter((section) => isObject(section) && Object.hasOwn(definition.fields, section.key))
      .map((section) => ({
        key: section.key,
        label: definition.fields[section.key],
        before: String(section.before || ""),
        after: String(section.after || "")
      }))
    : [];
  const previousValues = isObject(source.previousValues)
    ? Object.fromEntries(Object.entries(source.previousValues)
      .filter(([key]) => Object.hasOwn(definition.fields, key))
      .map(([key, item]) => [key, String(item || "")]))
    : {};
  return {
    id: normalizeText(source.id) || createId("proposal"),
    chatId: normalizeText(source.chatId),
    sourceMessageId: normalizeText(source.sourceMessageId),
    type,
    status: ["pending", "applied", "discarded", "reverted"].includes(source.status) ? source.status : "pending",
    createdAt: normalizeDate(source.createdAt),
    appliedAt: normalizeText(source.appliedAt),
    sections,
    previousValues
  };
}

function normalizeAiWorkspace(value) {
  const source = isObject(value) ? value : {};
  const chats = Array.isArray(source.chats) ? source.chats.map(normalizeChat) : [];
  const ids = new Set(chats.map((chat) => chat.id));
  const activeChatId = ids.has(source.activeChatId) ? source.activeChatId : chats[0]?.id || "";
  return {
    activeChatId,
    chats,
    proposals: Array.isArray(source.proposals) ? source.proposals.map(normalizeProposal) : []
  };
}

function ensureAiWorkspace(work, { createChat = false } = {}) {
  work.aiWorkspace = normalizeAiWorkspace(work.aiWorkspace);
  if (createChat && work.aiWorkspace.chats.length === 0) {
    const chat = createChatRecord();
    work.aiWorkspace.chats.push(chat);
    work.aiWorkspace.activeChatId = chat.id;
  }
  return work.aiWorkspace;
}

function createChatRecord(title = "新对话") {
  const timestamp = nowIso();
  return {
    id: createId("chat"),
    title: normalizeText(title).slice(0, CHAT_TITLE_LIMIT) || "新对话",
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: []
  };
}

function autoChatTitle(content) {
  const source = normalizeText(content)
    .replace(/[\r\n]+/g, " ")
    .replace(/[，。！？；：,.!?;:]+$/u, "")
    .slice(0, CHAT_TITLE_LIMIT);
  return source || "新对话";
}

function createMessage(role, content, extra = {}) {
  return normalizeMessage({
    id: createId("message"),
    role,
    content,
    status: extra.status || "complete",
    createdAt: nowIso(),
    retryOf: extra.retryOf
  });
}

function selectChatContext(chat, maxCharacters = CHAT_CONTEXT_CHARACTER_LIMIT) {
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  const selected = [];
  let used = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = normalizeMessage(messages[index]);
    const remaining = maxCharacters - used;
    if (remaining <= 0) {
      break;
    }
    if (message.content.length > remaining) {
      message.content = message.content.slice(-remaining);
    }
    used += message.content.length;
    selected.unshift({ role: message.role, content: message.content });
  }
  return selected;
}

function createArtifactProposal(work, chatId, type, generated, sourceMessageId = "") {
  if (!Object.hasOwn(ARTIFACT_DEFINITIONS, type)) {
    const error = new Error("不支持的创作资料类型");
    error.status = 400;
    throw error;
  }
  const definition = ARTIFACT_DEFINITIONS[type];
  const storyBible = normalizeStoryBible(work.storyBible);
  const sections = Object.entries(definition.fields).map(([key, label]) => ({
    key,
    label,
    before: storyBible[key] || "",
    after: String(generated?.[key] || "").trim()
  })).filter((section) => section.after);
  if (!sections.length) {
    const error = new Error("AI 没有返回可用的创作资料，请重试。");
    error.status = 422;
    throw error;
  }
  return normalizeProposal({
    id: createId("proposal"),
    chatId,
    sourceMessageId,
    type,
    status: "pending",
    createdAt: nowIso(),
    sections
  });
}

function applyArtifactProposal(work, proposal, sectionKeys) {
  if (proposal.status !== "pending" && proposal.status !== "reverted") {
    const error = new Error("这份草案已经处理，不能重复写入。");
    error.status = 409;
    throw error;
  }
  const allowed = new Set(proposal.sections.map((section) => section.key));
  const requested = Array.isArray(sectionKeys)
    ? sectionKeys.filter((key) => allowed.has(key))
    : [...allowed];
  if (!requested.length) {
    const error = new Error("请至少选择一个要写入的部分。");
    error.status = 400;
    throw error;
  }
  work.storyBible = normalizeStoryBible(work.storyBible);
  proposal.previousValues = {};
  for (const section of proposal.sections) {
    if (!requested.includes(section.key)) {
      continue;
    }
    proposal.previousValues[section.key] = work.storyBible[section.key] || "";
    work.storyBible[section.key] = section.after;
  }
  proposal.status = "applied";
  proposal.appliedAt = nowIso();
  return requested;
}

function revertArtifactProposal(work, proposal) {
  if (proposal.status !== "applied") {
    const error = new Error("只有已经写入的草案可以撤销。");
    error.status = 409;
    throw error;
  }
  work.storyBible = normalizeStoryBible(work.storyBible);
  for (const [key, value] of Object.entries(proposal.previousValues || {})) {
    work.storyBible[key] = String(value || "");
  }
  proposal.status = "reverted";
  proposal.appliedAt = "";
}

function normalizeDeltaAttributes(value) {
  if (!isObject(value)) {
    return undefined;
  }
  const attributes = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!ALLOWED_ATTRIBUTES.has(key)) {
      continue;
    }
    if (key === "header" && [2, 3].includes(Number(raw))) {
      attributes.header = Number(raw);
    } else if (key === "list" && ["ordered", "bullet"].includes(raw)) {
      attributes.list = raw;
    } else if (key === "link" && /^https?:\/\//i.test(String(raw || ""))) {
      attributes.link = String(raw).slice(0, 2000);
    } else if (["bold", "italic", "blockquote"].includes(key) && raw) {
      attributes[key] = true;
    }
  }
  return Object.keys(attributes).length ? attributes : undefined;
}

function normalizeRichContent(value) {
  if (!isObject(value) || !Array.isArray(value.ops)) {
    const error = new Error("富文本内容格式无效。");
    error.status = 400;
    throw error;
  }
  if (value.ops.length > 50000) {
    const error = new Error("富文本内容过大。");
    error.status = 413;
    throw error;
  }
  const ops = [];
  for (const rawOperation of value.ops) {
    if (!isObject(rawOperation)) {
      continue;
    }
    let insert;
    if (typeof rawOperation.insert === "string") {
      insert = rawOperation.insert.slice(0, 1000000);
    } else if (isObject(rawOperation.insert) && typeof rawOperation.insert.image === "string") {
      const image = rawOperation.insert.image.trim();
      if (!/^(https?:\/\/|\/data\/covers\/|data:image\/(png|jpeg|webp);base64,)/i.test(image)) {
        continue;
      }
      insert = { image: image.slice(0, 3500000) };
    } else {
      continue;
    }
    const attributes = normalizeDeltaAttributes(rawOperation.attributes);
    ops.push(attributes ? { insert, attributes } : { insert });
  }
  if (!ops.length) {
    ops.push({ insert: "\n" });
  }
  return { version: 1, ops };
}

function plainTextToRichContent(content) {
  const text = String(content || "").replace(/\r\n/g, "\n");
  return { version: 1, ops: [{ insert: text.endsWith("\n") ? text : `${text}\n` }] };
}

function applyInlineMarkdown(text, attributes = {}) {
  let output = text;
  if (attributes.link) {
    output = `[${output}](${attributes.link})`;
  }
  if (attributes.italic) {
    output = `*${output}*`;
  }
  if (attributes.bold) {
    output = `**${output}**`;
  }
  return output;
}

function renderMarkdownLine(content, attributes = {}) {
  if (attributes.header === 2) {
    return `## ${content}`;
  }
  if (attributes.header === 3) {
    return `### ${content}`;
  }
  if (attributes.blockquote) {
    return `> ${content}`;
  }
  if (attributes.list === "ordered") {
    return `1. ${content}`;
  }
  if (attributes.list === "bullet") {
    return `- ${content}`;
  }
  return content;
}

function richContentToMarkdown(value) {
  const delta = normalizeRichContent(value);
  const lines = [];
  let line = "";
  for (const operation of delta.ops) {
    if (isObject(operation.insert) && operation.insert.image) {
      line += `![章节插图](${operation.insert.image})`;
      continue;
    }
    const chunks = String(operation.insert).split("\n");
    chunks.forEach((chunk, index) => {
      if (chunk) {
        line += applyInlineMarkdown(chunk, operation.attributes || {});
      }
      if (index < chunks.length - 1) {
        lines.push(renderMarkdownLine(line, operation.attributes || {}));
        line = "";
      }
    });
  }
  if (line) {
    lines.push(line);
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

module.exports = {
  ARTIFACT_DEFINITIONS,
  CHAT_CONTEXT_CHARACTER_LIMIT,
  applyArtifactProposal,
  autoChatTitle,
  createArtifactProposal,
  createChatRecord,
  createMessage,
  ensureAiWorkspace,
  normalizeAiWorkspace,
  normalizeRichContent,
  plainTextToRichContent,
  revertArtifactProposal,
  richContentToMarkdown,
  selectChatContext
};
