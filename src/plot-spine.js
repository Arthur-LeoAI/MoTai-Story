"use strict";
const { appError } = require("./errors");
const { describeCanon, normalizeCanonObjects } = require("./canon-model");

// The story spine (plan 5.8, after Kenn Adams' improvisation exercise): six
// sentences that carry the main line of a story. "Because of that" may hold
// several sentences, one consequence each. Kept on the story as `work.spine`;
// a missing spine reads as an empty one.
//
//   once       Once upon a time…      (the hero and their world)
//   everyDay   Every day…             (how things are)
//   oneDay     Until one day…         (what goes wrong)
//   because    Because of that…       (what follows, one or more)
//   finally    Until finally…         (the climax)
//   everSince  And ever since then…   (how things are now, what has changed)

const SPINE_LINES = ["once", "everyDay", "oneDay", "because", "finally", "everSince"];
const MAX_BECAUSE = 8;
const MAX_LINE = 1000;
const SUGGESTIONS = 3;

const clean = (value, limit = MAX_LINE) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, limit) : "");
const isEnglish = (work) => work?.language === "en";

function normalizeSpine(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const spine = {};
  for (const key of SPINE_LINES) {
    if (key === "because") {
      const items = Array.isArray(source.because) ? source.because.map((item) => clean(item)) : [];
      // Empty sentences in the middle are kept while the writer works; at least one box is always there.
      spine.because = items.slice(0, MAX_BECAUSE);
      if (!spine.because.length) spine.because = [""];
    } else spine[key] = clean(source[key]);
  }
  spine.revision = Number.isInteger(source.revision) && source.revision > 0 ? source.revision : 0;
  spine.updatedAt = typeof source.updatedAt === "string" ? source.updatedAt : "";
  return spine;
}

/** Saves the writer's sentences against the revision they were read at. */
function updateSpine(work, body, now) {
  const current = normalizeSpine(work.spine);
  if (!body || typeof body !== "object" || !body.lines || typeof body.lines !== "object") throw appError("BAD_REQUEST");
  if (body.baseRevision !== current.revision) throw appError("REVISION_CONFLICT");
  if (body.lines.because !== undefined && (!Array.isArray(body.lines.because) || body.lines.because.length > MAX_BECAUSE)) throw appError("BAD_REQUEST");
  const next = normalizeSpine({ ...current, ...pick(body.lines) });
  next.revision = current.revision + 1;
  next.updatedAt = now;
  work.spine = next;
  return next;
}

function pick(lines) {
  return Object.fromEntries(SPINE_LINES.filter((key) => lines[key] !== undefined).map((key) => [key, lines[key]]));
}

// ---- Suggestions for one line ----------------------------------------------

const LABELS = {
  en: { once: "Once upon a time…", everyDay: "Every day…", oneDay: "Until one day…", because: "Because of that…", finally: "Until finally…", everSince: "And ever since then…" },
  zh: { once: "从前……", everyDay: "每一天……", oneDay: "直到有一天……", because: "因为这样……", finally: "直到最后……", everSince: "从那以后……" }
};
const PURPOSE = {
  en: { once: "who the hero is and the world they live in", everyDay: "how things usually are for them", oneDay: "the thing that goes wrong and starts the story", because: "a consequence of what happened just before", finally: "the climax, where it is decided", everSince: "how things are after, and what has changed" },
  zh: { once: "主角是谁、生活在怎样的世界", everyDay: "TA 平常的日子是什么样", oneDay: "打破日常、让故事开始的那件事", because: "紧接着上一句发生的后果", finally: "高潮：事情在这里见分晓", everSince: "结局：之后的日子，以及什么改变了" }
};

/** The spine as written so far, one line per sentence; the asked line is marked. */
function spineText(spine, english, target) {
  const labels = english ? LABELS.en : LABELS.zh;
  const empty = english ? "(empty)" : "（空）";
  const ask = english ? "← suggest this one" : "← 为这一句提建议";
  const rows = [];
  for (const key of SPINE_LINES) {
    if (key === "because") {
      spine.because.forEach((text, index) => {
        const here = target.line === "because" && target.index === index;
        rows.push(`${labels.because} ${text || empty}${here ? ` ${ask}` : ""}`);
      });
      if (target.line === "because" && target.index >= spine.because.length) rows.push(`${labels.because} ${empty} ${ask}`);
    } else rows.push(`${labels[key]} ${spine[key] || empty}${target.line === key ? ` ${ask}` : ""}`);
  }
  return rows.join("\n");
}

function eventsText(work, english) {
  const events = [...normalizeCanonObjects(work?.canon).events].sort((a, b) => a.storyOrder - b.storyOrder).slice(0, 40);
  return events.map((event, index) => `${index + 1}. ${event.title}${event.summary ? ` — ${event.summary.slice(0, 200)}` : ""}`).join("\n") || (english ? "none yet" : "暂无");
}

function checkTarget(spine, body) {
  const line = body?.line;
  if (!SPINE_LINES.includes(line)) throw appError("BAD_REQUEST");
  const index = line === "because" ? Number(body.index ?? spine.because.length) : 0;
  if (!Number.isInteger(index) || index < 0 || index > MAX_BECAUSE - 1) throw appError("BAD_REQUEST");
  return { line, index };
}

function suggestionRequest(work, body) {
  const english = isEnglish(work);
  const spine = normalizeSpine(work.spine);
  const target = checkTarget(spine, body);
  const label = (english ? LABELS.en : LABELS.zh)[target.line];
  const purpose = (english ? PURPOSE.en : PURPOSE.zh)[target.line];
  const cast = describeCanon(work, { limit: 3000 });
  const prompt = (english ? [
    `Suggest ${SUGGESTIONS} different ways to finish the sentence "${label}" in this novel's story spine. That sentence is about ${purpose}.`,
    `Story: "${work?.title || "Untitled story"}"`,
    `Premise: ${work?.premise || "none yet"}`,
    `Characters and relationships:\n${cast || "none yet"}`,
    `Events, in the order they happen:\n${eventsText(work, true)}`,
    `The spine so far:\n${spineText(spine, true, target)}`,
    "Each suggestion is one plain sentence that follows on from the sentences before it and leads into the ones after it. Use the people and events the story already has; do not add new main characters. Make the suggestions really different from each other. Write only what comes after the opening words, without repeating them. Write in English."
  ] : [
    `为这部小说的"故事骨架"中"${label}"这一句给出 ${SUGGESTIONS} 个不同的写法。这一句写的是：${purpose}。`,
    `作品：《${work?.title || "未命名作品"}》`,
    `一句话梗概：${work?.premise || "暂无"}`,
    `人物与关系：\n${cast || "暂无"}`,
    `事件（按发生顺序）：\n${eventsText(work, false)}`,
    `目前的故事骨架：\n${spineText(spine, false, target)}`,
    "每个建议是一句平实的话，接得上前面的句子，也引得出后面的句子。使用作品里已有的人物和事件，不要添加新的主要人物。几个建议之间要有明显不同。只写开头那几个字之后的内容，不要重复开头。用简体中文。"
  ]).join("\n\n");
  return {
    toolName: "suggest_spine_line",
    description: english ? "Suggest ways to finish one sentence of the story spine" : "为故事骨架的一句给出写法",
    system: english ? "You help a novelist find the main line of their story. Return the suggestions through the given tool." : "你帮助小说作者理清故事主线。请通过指定工具返回建议。",
    prompt,
    properties: {
      suggestions: { type: "array", items: { type: "string" }, description: english ? `${SUGGESTIONS} different sentences` : `${SUGGESTIONS} 个不同的句子` }
    },
    required: ["suggestions"]
  };
}

// Models sometimes repeat the opening words; the box already shows them.
function stripOpening(text, line) {
  const openings = [LABELS.en[line], LABELS.zh[line]].map((label) => label.replace(/[.…]+$/u, ""));
  let result = text;
  for (const opening of openings) {
    if (result.toLocaleLowerCase().startsWith(opening.toLocaleLowerCase())) result = result.slice(opening.length);
  }
  return result.replace(/^[\s.…,，、:：]+/u, "").trim();
}

function normalizeSuggestions(raw, line) {
  const items = Array.isArray(raw?.suggestions) ? raw.suggestions : [];
  const seen = new Set();
  const suggestions = [];
  for (const item of items) {
    const text = stripOpening(clean(item, 600), line);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    suggestions.push(text);
    if (suggestions.length === SUGGESTIONS) break;
  }
  if (!suggestions.length) throw appError("AI_ARTIFACT_EMPTY");
  return suggestions;
}

/** Built-in test AI: fixed suggestions that name the first person in Cast. */
function testSuggestions(work, body) {
  const spine = normalizeSpine(work.spine);
  const { line, index } = checkTarget(spine, body);
  const english = isEnglish(work);
  const hero = normalizeCanonObjects(work?.canon).entities.find((entity) => entity.type === "character")?.name || (english ? "the hero" : "主角");
  const ordinal = line === "because" ? ` ${index + 1}` : "";
  return normalizeSuggestions({
    suggestions: english
      ? [`${hero} — first idea for ${line}${ordinal}.`, `${hero} — second idea for ${line}${ordinal}.`, `${hero} — third idea for ${line}${ordinal}.`]
      : [`${hero}——${line}${ordinal} 的第一个想法。`, `${hero}——${line}${ordinal} 的第二个想法。`, `${hero}——${line}${ordinal} 的第三个想法。`]
  }, line);
}

module.exports = { SPINE_LINES, MAX_BECAUSE, normalizeSpine, updateSpine, suggestionRequest, normalizeSuggestions, testSuggestions };
