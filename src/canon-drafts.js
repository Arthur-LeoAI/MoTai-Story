"use strict";
const { appError } = require("./errors");
const { CARD_FIELDS, RELATION_KINDS, describeCanon, normalizeCanonObjects } = require("./canon-model");

// AI drafts of characters (plan 5.4 capture, 5.5 "describe someone in a
// sentence"). A draft is never saved here: it fills the character dialog,
// and the writer saves it or not. Prompts follow the story's language.

const CHARACTER_FIELDS = CARD_FIELDS.character;
const MAX_CANDIDATES = 6;

const isEnglish = (work) => work?.language === "en";
// A pronoun is never another name for someone.
const PRONOUNS = new Set(["he", "she", "him", "her", "his", "hers", "they", "them", "their", "it", "i", "me", "you", "we", "us", "他", "她", "它", "他们", "她们", "我", "你", "您"]);
// Names compare without case or a leading article: "the Governor" is "Governor".
const nameKey = (name) => String(name || "").trim().toLocaleLowerCase().replace(/^(the|a|an)\s+/, "");
const clean = (value, limit) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, limit) : "");

function existingNames(work) {
  const names = new Set();
  for (const entity of normalizeCanonObjects(work?.canon).entities) {
    for (const name of [entity.name, ...entity.aliases]) if (name) names.add(nameKey(name));
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
  const known = normalizeCanonObjects(work?.canon).entities.flatMap((entity) => [entity.name, ...entity.aliases]).filter(Boolean);
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
    const key = nameKey(name);
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


// ---- Characters, relationships and events from the manuscript ---------------
//
// One request per chapter, merged afterwards. The result is a set of drafts
// for the writer to tick and keep; nothing is saved here.

const MAX_CHAPTERS = 40;
const CHARS_PER_CHAPTER = 12000;
const MAX_EVENTS_PER_CHAPTER = 6;

function chapterExtractionRequest(work, chapter, { index, total, knownNames }) {
  const english = isEnglish(work);
  const body = String(chapter.content || "").slice(0, CHARS_PER_CHAPTER);
  const kinds = RELATION_KINDS.join(", ");
  const prompt = (english ? [
    `Read chapter ${index + 1} of ${total} of the novel "${work?.title || "Untitled story"}" and note what a writer would put on index cards.`,
    `People already known (use these names exactly when they appear): ${knownNames.join(", ") || "none yet"}`,
    `Chapter title: ${chapter.title || ""}`,
    `Chapter text:\n${body}`,
    [
      "Return:",
      "- characters: every named person who appears or is talked about in this chapter: name (the person's own name when the text gives it, not a title), other names used for them (titles, nicknames, short forms), one sentence on who they are, and what they want if the chapter shows it. Only what this chapter says. Groups, organisations, places and animals are not people: leave them out.",
      `- relations: how two of these people stand to each other, when the chapter makes it clear: from, to, kind (one of ${kinds}; "mentor" means from teaches to), a few words in the story's terms, and the tension between them if shown.`,
      `- events: up to ${MAX_EVENTS_PER_CHAPTER} things that happen in this chapter, in order: a short title, one sentence, the names of who takes part, and where (a place name, or empty).`,
      "Leave anything out rather than guess. Write in English."
    ].join("\n")
  ] : [
    `阅读小说《${work?.title || "未命名作品"}》第 ${index + 1} 章（共 ${total} 章），整理出作者会写在资料卡上的内容。`,
    `已知人物（出现时请沿用这些名字）：${knownNames.join("、") || "暂无"}`,
    `章节标题：${chapter.title || ""}`,
    `章节正文：\n${body}`,
    [
      "返回：",
      "- characters：本章出现或被提到的每个有名字的人物：名字（正文给出本名时用本名，不用头衔）、别的称呼（头衔、外号、简称）、一句话说明 TA 是谁、本章能看出的 TA 想要什么。只写本章的内容。组织、团体、地点和动物不是人物，不要列出。",
      `- relations：本章写明的两人关系：from、to、kind（取值 ${kinds}；mentor 表示 from 教导 to）、几个字的概括，以及本章体现的张力。`,
      `- events：本章发生的事，按顺序，最多 ${MAX_EVENTS_PER_CHAPTER} 件：简短标题、一句话、参与者名字、地点（地名，没有就留空）。`,
      "拿不准的就不写，不要猜测。用简体中文。"
    ].join("\n")
  ]).join("\n\n");
  const text = { type: "string" };
  return {
    toolName: "note_chapter",
    description: english ? "Index cards for one chapter" : "一章的资料卡",
    system: english ? "You read a novelist's manuscript and note its people, relationships and events. Return them through the given tool." : "你阅读小说稿件，整理其中的人物、关系和事件。请通过指定工具返回。",
    prompt,
    properties: {
      characters: { type: "array", items: { type: "object", properties: { name: text, aliases: { type: "array", items: text }, summary: text, want: text }, required: ["name", "summary"] } },
      relations: { type: "array", items: { type: "object", properties: { from: text, to: text, kind: { type: "string", enum: [...RELATION_KINDS] }, label: text, tension: text }, required: ["from", "to", "kind"] } },
      events: { type: "array", items: { type: "object", properties: { title: text, summary: text, participants: { type: "array", items: text }, location: text }, required: ["title"] } }
    },
    required: ["characters", "relations", "events"],
    truncated: String(chapter.content || "").length > CHARS_PER_CHAPTER
  };
}

function normalizeChapterExtraction(raw, chapterId) {
  const source = raw && typeof raw === "object" ? raw : {};
  const list = (value) => (Array.isArray(value) ? value : []);
  return {
    characters: list(source.characters).map((item) => ({
      name: clean(item?.name, 160),
      aliases: list(item?.aliases).map((alias) => clean(alias, 160)).filter((alias) => alias && !PRONOUNS.has(nameKey(alias))).slice(0, 10),
      summary: clean(item?.summary, 600),
      want: clean(item?.want, 2000)
    })).filter((item) => item.name),
    relations: list(source.relations).map((item) => ({
      from: clean(item?.from, 160),
      to: clean(item?.to, 160),
      kind: RELATION_KINDS.includes(item?.kind) ? item.kind : "custom",
      label: clean(item?.label, 120),
      tension: clean(item?.tension, 1000)
    })).filter((item) => item.from && item.to && nameKey(item.from) !== nameKey(item.to)),
    events: list(source.events).slice(0, MAX_EVENTS_PER_CHAPTER).map((item) => ({
      chapterId,
      title: clean(item?.title, 200),
      summary: clean(item?.summary, 4000),
      participants: list(item?.participants).map((name) => clean(name, 160)).filter(Boolean).slice(0, 20),
      location: clean(item?.location, 160)
    })).filter((item) => item.title)
  };
}

// Puts the chapters together: one card per person (matched by any of their
// names, never someone already in the Cast), one line per relationship, the
// events in chapter order. Names in relations and events are given as the
// card's main name, so the interface can link them.
// "the Governor", "the warden", "老船长": a role rather than a name.
function isTitle(name) {
  return /^(the|a|an)\s/i.test(name) || /^[a-z]/.test(name) || /^(老|小)?(船长|总督|将军|大人|先生|夫人|师父|掌柜)$/.test(name);
}

function mergeExtractions(work, chapters) {
  const known = new Map();
  for (const entity of normalizeCanonObjects(work?.canon).entities) {
    for (const name of [entity.name, ...entity.aliases]) if (name) known.set(nameKey(name), entity.name);
  }
  const people = [];
  const byName = new Map();
  const canonical = (name) => {
    const key = nameKey(clean(name, 160));
    return known.get(key) || byName.get(key)?.name || clean(name, 160);
  };
  for (const chapter of chapters) {
    for (const person of chapter.characters) {
      const keys = [person.name, ...person.aliases].map(nameKey);
      if (keys.some((key) => known.has(key))) continue;
      const existing = keys.map((key) => byName.get(key)).find(Boolean);
      if (existing) {
        for (const alias of [person.name, ...person.aliases]) if (alias !== existing.name && !existing.aliases.includes(alias)) existing.aliases.push(alias);
        existing.summary ||= person.summary;
        existing.card.want ||= person.want;
        for (const key of keys) byName.set(key, existing);
        continue;
      }
      const card = { name: person.name, aliases: person.aliases.filter((alias) => alias !== person.name), summary: person.summary, card: { want: person.want }, chapterId: chapter.chapterId };
      people.push(card);
      for (const key of keys) byName.set(key, card);
    }
  }
  const relations = [];
  const seen = new Set();
  for (const chapter of chapters) {
    for (const relation of chapter.relations) {
      const from = canonical(relation.from);
      const to = canonical(relation.to);
      const key = [from, to].sort().join("|") + `|${relation.kind}`;
      if (from === to || seen.has(key)) continue;
      seen.add(key);
      relations.push({ ...relation, from, to });
    }
  }
  const events = chapters.flatMap((chapter) => chapter.events.map((event) => ({ ...event, participants: [...new Set(event.participants.map(canonical))] })));
  for (const person of people) {
    if (!isTitle(person.name)) continue;
    const own = person.aliases.find((alias) => !isTitle(alias));
    if (!own) continue;
    person.aliases = [person.name, ...person.aliases.filter((alias) => alias !== own)];
    person.name = own;
  }
  const mainName = (name) => {
    const key = nameKey(name);
    return people.find((person) => [person.name, ...person.aliases].some((alias) => nameKey(alias) === key))?.name || name;
  };
  return {
    characters: people.map((person) => ({ ...person, aliases: person.aliases.slice(0, 30) })),
    relations: relations.map((relation) => ({ ...relation, from: mainName(relation.from), to: mainName(relation.to) })),
    events: events.map((event) => ({ ...event, participants: [...new Set(event.participants.map(mainName))] }))
  };
}

// The built-in test AI: people found by the candidates rule, the first
// sentence of each chapter as its one event.
function testChapterExtraction(work, chapter) {
  const english = isEnglish(work);
  const text = String(chapter.content || "");
  const names = testCandidates({ ...work, canon: { entities: [] } }, `\n${text}`).map((item) => item.name);
  const first = text.split(english ? /(?<=[.!?])\s+/u : /(?<=[。！？])/u).map((part) => part.trim()).find(Boolean) || "";
  return normalizeChapterExtraction({
    characters: names.map((name) => ({ name, summary: english ? `Appears in "${chapter.title || ""}".` : `出现在《${chapter.title || ""}》。` })),
    relations: names.length > 1 ? [{ from: names[0], to: names[1], kind: "friend" }] : [],
    events: first ? [{ title: first.slice(0, 80), summary: first, participants: names.filter((name) => first.includes(name)) }] : []
  }, chapter.id);
}

module.exports = {
  CHARS_PER_CHAPTER,
  MAX_CANDIDATES,
  MAX_CHAPTERS,
  chapterExtractionRequest,
  mergeExtractions,
  normalizeChapterExtraction,
  testChapterExtraction,
  candidatesRequest,
  characterDraftRequest,
  normalizeCandidates,
  normalizeCharacterDraft,
  testCandidates,
  testCharacterDraft
};
