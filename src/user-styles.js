"use strict";
const { appError } = require("./errors");
const { normalizeStyle, MAX_STYLE } = require("./styles");

// The writer's own style cards (plan 5.9.1, "your own styles"). They are kept
// per user (document collection `userStyles`), seen only by that user, and
// can be used in any of their stories of the same language.
//
// Three ways to make one: describe it in words or paste a passage you like
// (the AI drafts the card), or write it by hand. A style can also be exported
// to a file and imported again.

const MAX_STYLES = 100;
const SOURCES = new Set(["user", "imported"]);

function createUserStyleRepository(store, { now = () => new Date().toISOString(), makeId }) {
  const read = async (userId) => {
    if (!userId) throw appError("AUTH_REQUIRED");
    const stored = await store.readDocument("userStyles", userId);
    return Array.isArray(stored?.styles) ? stored.styles : [];
  };

  function fieldsFrom(body, current = {}) {
    if (!body || typeof body !== "object") throw appError("BAD_REQUEST");
    const next = normalizeStyle({ ...current, ...pick(body), id: current.id || "" }, { source: SOURCES.has(body.source) ? body.source : current.source || "user" });
    if (!next.name) throw appError("STYLE_NAME_REQUIRED");
    if (!next.guidance) throw appError("STYLE_GUIDANCE_REQUIRED");
    return next;
  }

  async function list(userId) {
    return (await read(userId)).map((style) => normalizeStyle(style, { source: style.source }));
  }

  async function create(userId, body) {
    const style = fieldsFrom(body);
    let created;
    await store.transactDocument("userStyles", userId, (current) => {
      const styles = Array.isArray(current?.styles) ? current.styles : [];
      if (styles.length >= MAX_STYLES) throw appError("STYLE_LIMIT_REACHED", { limit: MAX_STYLES });
      created = { ...style, id: makeId("style"), revision: 1, updatedAt: now() };
      return { ...(current || {}), styles: [...styles, created] };
    });
    return created;
  }

  async function update(userId, styleId, body) {
    let updated;
    await store.transactDocument("userStyles", userId, (current) => {
      const styles = Array.isArray(current?.styles) ? current.styles : [];
      const index = styles.findIndex((style) => style.id === styleId);
      if (index < 0) throw appError("STYLE_NOT_FOUND");
      if (body?.baseRevision !== styles[index].revision) throw appError("REVISION_CONFLICT");
      updated = { ...fieldsFrom(body, styles[index]), id: styleId, revision: styles[index].revision + 1, updatedAt: now() };
      const next = [...styles];
      next[index] = updated;
      return { ...current, styles: next };
    });
    return updated;
  }

  async function remove(userId, styleId, body) {
    await store.transactDocument("userStyles", userId, (current) => {
      const styles = Array.isArray(current?.styles) ? current.styles : [];
      const style = styles.find((item) => item.id === styleId);
      if (!style) throw appError("STYLE_NOT_FOUND");
      if (body?.baseRevision !== style.revision) throw appError("REVISION_CONFLICT");
      return { ...current, styles: styles.filter((item) => item.id !== styleId) };
    });
    return { id: styleId };
  }

  return { list, create, update, remove };
}

function pick(body) {
  const keys = ["language", "name", "description", "guidance", "samples"];
  return Object.fromEntries(keys.filter((key) => body[key] !== undefined).map((key) => [key, body[key]]));
}

// ---- An AI draft of a style card -----------------------------------------------

const clean = (value, limit) => (typeof value === "string" ? value.trim().replace(/[ \t]+/g, " ").slice(0, limit) : "");

function draftRequest(body) {
  const english = body?.language === "en";
  const description = clean(body?.description, 1000);
  const passage = clean(body?.passage, 6000);
  if (!description && !passage) throw appError("STYLE_SOURCE_REQUIRED");
  const prompt = (english ? [
    "Draft a writing-style card that a novelist can reuse. The card says how to write, never what to write about.",
    description ? `The style, in the author's words: ${description}` : "",
    passage ? `A passage the author likes, to describe the style of (do not quote it, do not name or guess its author, and do not mention its people, places or events):\n${passage}` : "",
    "Fill in: a short name for the style (descriptive, never a person's name); one sentence on what it is like; guidance that covers word choice, sentence length and rhythm, point of view and tense, dialogue, imagery, and what to avoid (plain sentences a writer can follow, about 80 to 150 words); and one new sample of about 60 to 90 words, written in this style about a different subject from anything above. Write in English."
  ] : [
    "起草一张小说作者可以反复使用的写作风格卡。风格卡只说怎么写，不说写什么。",
    description ? `作者描述的风格：${description}` : "",
    passage ? `作者喜欢的一段文字，请据此描述它的风格（不要引用原文，不要说出或猜测作者，也不要提到其中的人物、地点和情节）：\n${passage}` : "",
    "填写：风格的简短名称（描述性的，不用人名）；一句话说明这种风格是什么样；写法要点，涵盖用词、句子长短与节奏、叙述视角与时态、对白、意象、要避免的写法（作者能照着做的平实句子，约八十到一百五十字）；以及一段新的示范，约八十到一百二十字，用这种风格写一个与上文无关的题材。用简体中文。"
  ]).filter(Boolean).join("\n\n");
  return {
    toolName: "draft_style_card",
    description: english ? "Draft a writing-style card" : "起草写作风格卡",
    system: english ? "You help novelists describe writing styles they can reuse. Return the card through the given tool." : "你帮助小说作者描述可以反复使用的写作风格。请通过指定工具返回风格卡。",
    prompt,
    properties: {
      name: { type: "string", description: english ? "A short descriptive name" : "简短的描述性名称" },
      description: { type: "string", description: english ? "One sentence" : "一句话" },
      guidance: { type: "string", description: english ? "How to write in this style" : "写法要点" },
      sample: { type: "string", description: english ? "A new sample in this style" : "新写的示范" }
    },
    required: ["name", "description", "guidance", "sample"]
  };
}

/** A draft card, not saved; refuses a draft that copies the passage it was given. */
function normalizeDraft(raw, body) {
  const language = body?.language === "en" ? "en" : "zh-CN";
  // Models sometimes write a line break as the two characters "\n".
  const breaks = (value) => (typeof value === "string" ? value.replace(/\\n/g, "\n") : value);
  const draft = normalizeStyle({ language, name: raw?.name, description: raw?.description, guidance: breaks(raw?.guidance), samples: [breaks(raw?.sample)] });
  if (!draft.name || !draft.guidance) throw appError("AI_ARTIFACT_EMPTY");
  // A sample must be new writing, not the pasted passage or a long piece of it.
  const passage = clean(body?.passage, 6000);
  if (passage && draft.samples[0] && sharesLongRun(draft.samples[0], passage)) draft.samples = [];
  return { language: draft.language, name: draft.name, description: draft.description, guidance: draft.guidance, samples: draft.samples };
}

// True when the two texts share a run of 8 words (or 16 characters in Chinese).
function sharesLongRun(a, b) {
  const cjk = /[㐀-鿿]/u.test(a);
  if (cjk) {
    const squeeze = (text) => text.replace(/\s+/g, "");
    const left = squeeze(a);
    const right = squeeze(b);
    for (let index = 0; index + 16 <= left.length; index += 1) if (right.includes(left.slice(index, index + 16))) return true;
    return false;
  }
  const words = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, " ").split(/\s+/).filter(Boolean);
  const left = words(a);
  const right = ` ${words(b).join(" ")} `;
  for (let index = 0; index + 8 <= left.length; index += 1) if (right.includes(` ${left.slice(index, index + 8).join(" ")} `)) return true;
  return false;
}

function testDraft(body) {
  const english = body?.language === "en";
  if (!clean(body?.description, 1000) && !clean(body?.passage, 6000)) throw appError("STYLE_SOURCE_REQUIRED");
  return normalizeDraft(english
    ? { name: "Quiet and close", description: "Close to one character, quiet and exact.", guidance: "Stay close to one character. Use plain words and short paragraphs. Show feeling through small actions.", sample: "The kettle had gone cold an hour ago. She did not get up to light it again." }
    : { name: "安静贴近", description: "贴近一个人物，安静而准确。", guidance: "贴近一个人物写。用平实的词，段落要短。用小动作写情绪。", sample: "水壶一个钟头前就凉了。她没有起身再去点火。" }, body);
}

module.exports = { createUserStyleRepository, draftRequest, normalizeDraft, testDraft, MAX_STYLES, MAX_STYLE };
