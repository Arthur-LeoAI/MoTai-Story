"use strict";
const { appError } = require("./errors");
const { describeCanon, normalizeCanonObjects } = require("./canon-model");

// "Stress-test this rule" (plan 5.6). Two AI steps, neither saves anything:
//   1. questionsRequest: two or three pointed "If that is true, why can't…?"
//      questions that find the loopholes and side effects a rule leaves open.
//   2. foldRequest: the writer's own answers folded into the rule's card
//      (cost, exceptions, detail). The result fills the rule dialog; the
//      writer saves it or not.
// Prompts are written for English first, then Chinese.

const MAX_QUESTIONS = 3;
const LIMITS = { cost: 2000, exception: 2000, detail: 600 };

const clean = (value, limit) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, limit) : "");
const isEnglish = (work) => work?.language === "en";

function findRule(work, ruleId) {
  const rule = normalizeCanonObjects(work?.canon).entities.find((entity) => entity.id === ruleId && entity.type === "rule");
  if (!rule) throw appError("CANON_ITEM_NOT_FOUND");
  return rule;
}

function ruleText(rule, english) {
  const rows = english
    ? [`Rule: ${rule.name}`, `Cost or limit: ${rule.card.cost || "(none yet)"}`, `Exceptions: ${rule.card.exception || "(none yet)"}`, rule.summary ? `More: ${rule.summary}` : ""]
    : [`规则：${rule.name}`, `代价或限制：${rule.card.cost || "（暂无）"}`, `例外：${rule.card.exception || "（暂无）"}`, rule.summary ? `更多说明：${rule.summary}` : ""];
  return rows.filter(Boolean).join("\n");
}

function worldContext(work, rule, english) {
  const world = work?.world && typeof work.world === "object" ? work.world : {};
  const sentence = world.what || world.here
    ? (english ? `The world: a world ${world.what || "…"}, in which ${world.here || "…"}.` : `世界：一个${world.what || "……"}的世界，在这里${world.here || "……"}。`)
    : "";
  const others = normalizeCanonObjects(work?.canon).entities
    .filter((entity) => entity.type === "rule" && entity.id !== rule.id)
    .map((entity) => `- ${entity.name}${entity.card.cost ? ` (${english ? "cost" : "代价"}: ${clean(entity.card.cost, 200)})` : ""}`)
    .join("\n");
  return [
    `${english ? "Story" : "作品"}: ${work?.title || (english ? "Untitled story" : "未命名作品")}`,
    work?.premise ? `${english ? "Premise" : "梗概"}: ${work.premise}` : "",
    sentence,
    others ? `${english ? "Other rules of this world" : "这个世界的其他规则"}:\n${others}` : ""
  ].filter(Boolean);
}

function questionsRequest(work, ruleId) {
  const english = isEnglish(work);
  const rule = findRule(work, ruleId);
  const cast = describeCanon(work, { limit: 1500 });
  const prompt = (english ? [
    "Stress-test one rule of a novel's world. Ask the questions a sharp reader would ask the moment they understood the rule.",
    ...worldContext(work, rule, true),
    cast ? `People and places so far:\n${cast}` : "",
    `The rule:\n${ruleText(rule, true)}`,
    `Ask ${MAX_QUESTIONS} short questions, each in the form "If that is true, why can't…?", "If that is true, why doesn't…?" or "What stops…?". Each must point at a different weakness: a loophole someone could exploit, a side effect the world would show everywhere, or a way the rule would change ordinary life, power or money. Be concrete: use the people and places above where they fit. One sentence each, in plain English. Do not answer them, and do not ask about anything the rule, its cost or its exceptions already settle.`
  ] : [
    "为一部小说的世界规则做\"压力测试\"：提出读者一旦理解这条规则就会追问的问题。",
    ...worldContext(work, rule, false),
    cast ? `已有的人物与地点：\n${cast}` : "",
    `这条规则：\n${ruleText(rule, false)}`,
    `提出 ${MAX_QUESTIONS} 个简短的问题，句式如"如果这样，那为什么不能……？""如果这样，为什么没有……？"或"是什么阻止了……？"。每个问题指向不同的弱点：可以被利用的漏洞、世界里本该处处可见的后果、或这条规则对日常生活、权力、金钱的改变。尽量具体，合适时用上面的人物和地点。每个问题一句话。不要回答，也不要问规则、代价或例外已经说明的事。用简体中文。`
  ]).filter(Boolean).join("\n\n");
  return {
    toolName: "stress_test_rule",
    description: english ? "Ask pointed questions about a world rule" : "就一条世界规则提出追问",
    system: english ? "You help a novelist make the rules of their world hold together. Return the questions through the given tool." : "你帮助小说作者让世界规则经得起推敲。请通过指定工具返回问题。",
    prompt,
    properties: { questions: { type: "array", items: { type: "string" }, description: english ? `${MAX_QUESTIONS} different questions` : `${MAX_QUESTIONS} 个不同的问题` } },
    required: ["questions"]
  };
}

function normalizeQuestions(raw) {
  const seen = new Set();
  const questions = [];
  for (const item of Array.isArray(raw?.questions) ? raw.questions : []) {
    const text = clean(item, 400);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    questions.push(text);
    if (questions.length === MAX_QUESTIONS) break;
  }
  if (!questions.length) throw appError("AI_ARTIFACT_EMPTY");
  return questions;
}

function normalizeAnswers(body) {
  const answers = (Array.isArray(body?.answers) ? body.answers : [])
    .map((item) => ({ question: clean(item?.question, 400), answer: clean(item?.answer, 2000) }))
    .filter((item) => item.question && item.answer)
    .slice(0, MAX_QUESTIONS);
  if (!answers.length) throw appError("RULE_ANSWERS_REQUIRED");
  return answers;
}

function foldRequest(work, ruleId, body) {
  const english = isEnglish(work);
  const rule = findRule(work, ruleId);
  const answers = normalizeAnswers(body);
  const exchange = answers.map((item, index) => (english ? `Q${index + 1}: ${item.question}\nAuthor: ${item.answer}` : `问${index + 1}：${item.question}\n作者：${item.answer}`)).join("\n\n");
  const prompt = (english ? [
    "The author of a novel answered questions about one rule of their world. Fold the answers into the rule's card.",
    `The rule as it stands:\n${ruleText(rule, true)}`,
    `The questions and the author's answers:\n${exchange}`,
    "Return the full new text of three fields: the cost or limit, the exceptions, and \"more\" (anything else that settles how the rule works). Keep what each field already says and add what the answers settle, in the author's own terms. Put each point in exactly one field and never repeat a point across fields: a price paid or a limit goes in the cost; a case where the rule does not work goes in the exceptions; anything else (history, how people live with the rule) goes in \"more\". Use only what the author said, without changing its meaning: add no ideas of your own, and leave out an answer that settles nothing. Keep each field short and plain: a sentence or two, or a short list joined with semicolons. Write in English."
  ] : [
    "小说作者回答了关于一条世界规则的追问。请把这些回答整理进规则卡。",
    `规则现状：\n${ruleText(rule, false)}`,
    `追问与作者的回答：\n${exchange}`,
    "返回三个字段整理后的完整文字：代价或限制、例外、更多说明（其他能说明规则如何运作的内容）。保留每个字段原有的内容，补上回答里确定下来的东西，用作者自己的说法。每一点只放进一个字段，不要在不同字段里重复：要付出的代价或限制放进代价；规则不起作用的情况放进例外；其他内容（来历、人们怎样与这条规则共处）放进更多说明。只用作者说过的，不要改变原意：不要加入你自己的想法，没有确定任何事的回答就不要写进去。每个字段简短平实：一两句话，或用分号隔开的简短列表。用简体中文。"
  ]).join("\n\n");
  return {
    toolName: "fold_rule_answers",
    description: english ? "Fold the author's answers into a rule card" : "把作者的回答整理进规则卡",
    system: english ? "You keep a novelist's world rules tidy, in their own words. Return the card through the given tool." : "你用作者自己的话整理世界规则。请通过指定工具返回规则卡。",
    prompt,
    properties: {
      cost: { type: "string", description: english ? "What the rule costs or what limits it" : "代价或限制" },
      exception: { type: "string", description: english ? "When the rule does not hold" : "例外" },
      detail: { type: "string", description: english ? "Anything else that settles how the rule works" : "其他说明" }
    },
    required: ["cost", "exception", "detail"]
  };
}

// What a field gained, as letters only (case, spaces and punctuation ignored).
const letters = (text) => text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
function addedText(next, before) {
  const all = letters(next);
  const old = letters(before);
  return old && all.startsWith(old) ? all.slice(old.length) : all === old ? "" : all;
}

// Share of two-character pieces the two texts have in common (0 to 1).
function similarity(a, b) {
  if (!a || !b) return 0;
  const pieces = (text) => new Set(Array.from({ length: Math.max(text.length - 1, 1) }, (_, index) => text.slice(index, index + 2)));
  const first = pieces(a);
  const second = pieces(b);
  let shared = 0;
  for (const piece of first) if (second.has(piece)) shared += 1;
  return shared / Math.min(first.size, second.size);
}

/** A draft of the card: an empty answer from the AI never wipes what the card already says. */
function normalizeFold(raw, work, ruleId) {
  const rule = findRule(work, ruleId);
  const current = { cost: rule.card.cost || "", exception: rule.card.exception || "", detail: rule.summary || "" };
  const draft = {};
  // The prompt shows an empty field as "(none yet)"; a model may echo it back.
  const empty = (text) => /^[(（]?\s*(none yet|none|n\/a|暂无|无)\s*[)）]?[.。]?$/i.test(text);
  for (const key of Object.keys(LIMITS)) {
    const value = clean(raw?.[key], LIMITS[key]);
    draft[key] = value && !empty(value) ? value : current[key];
  }
  // Each point belongs in one field. When two fields gain nearly the same
  // text, it stays in the first (cost, then exceptions, then more).
  const order = ["cost", "exception", "detail"];
  for (let later = 1; later < order.length; later += 1) {
    const added = addedText(draft[order[later]], current[order[later]]);
    if (!added) continue;
    for (let earlier = 0; earlier < later; earlier += 1) {
      if (similarity(added, addedText(draft[order[earlier]], current[order[earlier]])) >= 0.5) {
        draft[order[later]] = current[order[later]];
        break;
      }
    }
  }
  if (draft.cost === current.cost && draft.exception === current.exception && draft.detail === current.detail) throw appError("AI_ARTIFACT_EMPTY");
  return draft;
}

/** Built-in test AI. */
function testQuestions(work, ruleId) {
  const rule = findRule(work, ruleId);
  const english = isEnglish(work);
  return normalizeQuestions({
    questions: english
      ? [`If "${rule.name}" is true, why doesn't everyone use it?`, "What stops a ruler from using it on a whole city?", "Why hasn't anyone sold it?"]
      : [`如果"${rule.name}"成立，为什么不是人人都用？`, "是什么阻止了统治者对整座城的人使用它？", "为什么没有人拿它做买卖？"]
  });
}

function testFold(work, ruleId, body) {
  const rule = findRule(work, ruleId);
  const answers = normalizeAnswers(body);
  const added = answers.map((item) => item.answer).join("; ");
  return normalizeFold({ cost: rule.card.cost || "", exception: [rule.card.exception, added].filter(Boolean).join("; "), detail: rule.summary || "" }, work, ruleId);
}

module.exports = { questionsRequest, normalizeQuestions, foldRequest, normalizeFold, testQuestions, testFold };
