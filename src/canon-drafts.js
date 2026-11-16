"use strict";
const { appError } = require("./errors");
const { CARD_FIELDS, describeCanon, normalizeCanonObjects } = require("./canon-model");

// AI drafts of characters (plan 5.4 capture, 5.5 "describe someone in a
// sentence"). A draft is never saved here: it fills the character dialog,
// and the writer saves it or not. Prompts follow the story's language.

const CHARACTER_FIELDS = CARD_FIELDS.character;
const MAX_CANDIDATES = 6;

const isEnglish = (work) => work?.language === "en";
const clean = (value, limit) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, limit) : "");

function existingNames(work) {
  const names = new Set();
  for (const entity of normalizeCanonObjects(work?.canon).entities) {
    for (const name of [entity.name, ...entity.aliases]) if (name) names.add(name.toLocaleLowerCase());
  }
  return names;
}

function storyContext(work, english) {
  const cast = describeCanon(work, { limit: 3000 });
  return english
    ? [`Story: "${work?.title || "Untitled story"}"`, `Premise: ${work?.premise || "none yet"}`, `Characters and relationships so far:\n${cast || "none yet"}`]
    : [`作品：《${work?.title || "未命名作品"}》`, `一句话梗概：${work?.premise || "暂无"}`, `已有的人物与关系：\n${cast || "暂无"}`];
}

// ---- One character from a sentence -----------------------------------------

function characterDraftRequest(work, { description, conversation = "" }) {
  const english = isEnglish(work);
  const labels = english
    ? { want: "What they want, in their own eyes", obstacle: "What stands in their way, or what they fear", change: "How they are different by the end (empty if the description gives no hint)", appearance: "How they look", voice: "How they speak", secret: "A secret, only if the description suggests one", background: "The past that matters in the story" }
    : { want: "TA 自己眼里想要什么", obstacle: "什么在拦着 TA，或 TA 害怕什么", change: "故事结束时 TA 的变化（描述里没有线索就留空）", appearance: "外貌", voice: "说话方式", secret: "秘密（只有描述里有暗示时才写）", background: "在故事里仍起作用的过去" };
  const properties = {
    name: { type: "string", description: english ? "The character's name as the author would write it" : "人物的名字，按作者的写法" },
    summary: { type: "string", description: english ? "Who they are, in one sentence" : "一句话：TA 是谁" },
    aliases: { type: "array", items: { type: "string" }, description: english ? "Other names or titles, if any" : "别名或称号（如有）" },
    ...Object.fromEntries(CHARACTER_FIELDS.map((key) => [key, { type: "string", description: labels[key] }]))
  };
  const prompt = (english ? [
    "Sketch one character card for this novel from the author's description. It is a draft: the author will check it before keeping it.",
    ...storyContext(work, true),
    conversation ? `The conversation where this person came up:\n${conversation}` : "",
    `The author's description: ${description}`,
    "Stay with what the description and the story say. Fill a field only when there is something to go on; leave the rest empty rather than inventing. Keep each answer to one or two plain sentences. Write in English."
  ] : [
    "根据作者的描述，为这部小说起草一张人物卡。这是草稿，作者确认后才会保存。",
    ...storyContext(work, false),
    conversation ? `提到这个人物的对话：\n${conversation}` : "",
    `作者的描述：${description}`,
    "只依据描述和作品已有内容。有依据时才填写，没有依据的字段留空，不要编造。每项用一两句平实的话。用简体中文。"
  ]).filter(Boolean).join("\n\n");
  return {
    toolName: "sketch_character",
    description: english ? "Sketch a character card" : "起草人物卡",
    system: english ? "You help a novelist sketch characters. Return the card through the given tool." : "你帮助小说作者起草人物。请通过指定工具返回人物卡。",
    prompt,
    properties,
    required: ["name", "summary", ...CHARACTER_FIELDS]
  };
}

function normalizeCharacterDraft(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const name = clean(source.name, 160);
  if (!name) throw appError("AI_ARTIFACT_EMPTY");
  const card = {};
  for (const key of CHARACTER_FIELDS) card[key] = clean(source[key] ?? source.card?.[key], 2000);
  const aliases = Array.isArray(source.aliases)
    ? [...new Set(source.aliases.map((item) => clean(item, 160)).filter((item) => item && item !== name))].slice(0, 30)
    : [];
  return { name, aliases, summary: clean(source.summary, 600), card, notes: "" };
}

// The built-in test AI: a predictable draft taken from the description.
function testCharacterDraft(work, description) {
  const english = isEnglish(work);
  const text = clean(description, 600);
  const match = english ? text.match(/\b([A-Z][a-z]+(?: [A-Z][a-z]+)?)\b/) : text.match(/^([^，,。：:\s]{1,6})[，,：:]/);
  const name = match?.[1] || (english ? "Unnamed" : "无名者");
  return normalizeCharacterDraft({
    name,
    summary: text,
    want: english ? "To be taken seriously." : "被人认真对待。",
    obstacle: english ? "Nobody yet knows what they are capable of." : "还没有人知道 TA 能做到什么。"
  });
}

// ---- New people in a conversation --------------------------------------------

function candidatesRequest(work, exchange) {
  const english = isEnglish(work);
  const known = [...existingNames(work)];
  const prompt = (english ? [
    "List the people (characters of the story) named in this exchange between an author and their assistant who are not yet in the story's cast.",
    `Already in the cast (leave these out): ${known.join(", ") || "nobody yet"}`,
    `The exchange:\n${exchange}`,
    `Only people with a name or a clear title. No places, groups or objects. At most ${MAX_CANDIDATES}. For each, one sentence on who they are, from the exchange only. An empty list is a good answer when nobody new is named.`
  ] : [
    "列出作者与助手的这段对话中提到、但还不在作品人物表里的人物。",
    `已在人物表中（不要列出）：${known.join("、") || "暂无"}`,
    `对话：\n${exchange}`,
    `只要有名字或明确称号的人物，不要地点、组织或物品。最多 ${MAX_CANDIDATES} 个。每人一句话说明 TA 是谁，只依据对话。没有新人物时返回空列表。`
  ]).join("\n\n");
  return {
    toolName: "list_new_characters",
    description: english ? "List characters named but not yet in the cast" : "列出新出现的人物",
    system: english ? "You read a novelist's working conversation and note new characters. Return them through the given tool." : "你阅读小说作者的工作对话，记下新出现的人物。请通过指定工具返回。",
    prompt,
    properties: {
      characters: {
        type: "array",
        items: { type: "object", properties: { name: { type: "string" }, summary: { type: "string" } }, required: ["name", "summary"] }
      }
    },
    required: ["characters"]
  };
}

// Never offers someone already in the cast, whatever the AI returned.
function normalizeCandidates(raw, work) {
  const list = Array.isArray(raw?.characters) ? raw.characters : Array.isArray(raw) ? raw : [];
  const known = existingNames(work);
  const seen = new Set();
  const result = [];
  for (const item of list) {
    const name = clean(item?.name, 160);
    const key = name.toLocaleLowerCase();
    if (!name || known.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push({ name, summary: clean(item?.summary, 300) });
    if (result.length >= MAX_CANDIDATES) break;
  }
  return result;
}

const ENGLISH_NOT_NAMES = new Set("A An The I I'm I'd He She They We You It His Her Their Our Your Its This That These Those What Who Whom Why When Where How Which Maybe Perhaps Yes No Not And But Or So If Then Also Just Only Even Still Yet Chapter Part Act Scene Mr Mrs Ms Dr Sir Lady Lord Please Thanks Thank Let Tell Draft Story".split(" "));

// The built-in test AI: names a reader would spot without understanding the
// text. English: capitalised words that do not open a sentence. Chinese: a
// name in quotation marks, or after 叫 / 名叫.
function testCandidates(work, exchange) {
  const english = isEnglish(work);
  const found = [];
  if (english) {
    for (const match of String(exchange).matchAll(/(^|[^.!?:\n]\s)([A-Z][a-z]{2,})\b/gm)) {
      if (match[1] === "" || ENGLISH_NOT_NAMES.has(match[2])) continue;
      found.push(match[2]);
    }
  } else {
    for (const match of String(exchange).matchAll(/[“「]([^”」\s]{2,4})[”」]|名?叫([一-鿿]{2,3})/g)) found.push(match[1] || match[2]);
  }
  return normalizeCandidates({ characters: found.map((name) => ({ name, summary: english ? `Named in the conversation as ${name}.` : `对话中提到的${name}。` })) }, work);
}

module.exports = {
  MAX_CANDIDATES,
  candidatesRequest,
  characterDraftRequest,
  normalizeCandidates,
  normalizeCharacterDraft,
  testCandidates,
  testCharacterDraft
};
