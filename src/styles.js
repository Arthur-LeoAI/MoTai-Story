"use strict";
const { appError } = require("./errors");

// Writing styles (plan 5.9.1): a style card is a reusable description of how
// to write (word choice, sentence rhythm, point of view, dialogue, imagery,
// what to avoid), with a short sample. It changes how a passage is told,
// never what happens in it.
//
// Built-in styles have descriptive names only (no living authors), and each
// story language has its own set rather than a translation. Every sample
// here was written for this file.

const MAX = { name: 80, description: 300, guidance: 3000, sample: 2000, samples: 3 };

const BUILTIN_STYLES = Object.freeze([
  {
    id: "builtin:plain",
    language: "en",
    name: "Plain and spare",
    description: "Short, concrete sentences. Show what happens and let the reader feel it.",
    guidance: "Use short declarative sentences and everyday words. Prefer concrete nouns and strong verbs to adjectives and adverbs. Show feeling through action and detail, never name it. Keep dialogue clipped and tag it with \"said\" or not at all. Cut every sentence that explains what the scene already shows. No metaphors unless they are plain and physical.",
    samples: ["She put the map on the table. Kael did not touch it. Outside, a cart went by, and then another. \"You drew this,\" he said. \"No.\" She folded her hands so he would not see them shake. The lamp needed oil. Neither of them got up to fill it."]
  },
  {
    id: "builtin:dramatic",
    language: "en",
    name: "Dramatic",
    description: "High stakes, sharp turns and charged dialogue; every scene pushes forward.",
    guidance: "Open scenes late and end them on a turn or a question. Keep the stakes in view: what each character stands to lose. Let dialogue carry conflict, with interruptions, reversals and things left unsaid. Vary sentence length for pace: long sentences to build, short ones to strike. Use strong verbs and vivid but not purple detail. Give each scene a clear change from beginning to end.",
    samples: ["\"Burn it,\" Kael said. Mira held the map closer to the lamp, close enough that the paper curled. \"Say that again,\" she whispered, \"and mean it this time.\" He took a step toward her. Then another. Somewhere below, the harbour bell began to ring, and they both knew what it meant: the wardens had found the boat."]
  },
  {
    id: "builtin:gothic",
    language: "en",
    name: "Gothic",
    description: "Dread, decay and old secrets; the setting presses on the characters.",
    guidance: "Build atmosphere through setting: old buildings, weather, darkness, sound. Let dread grow slowly; suggest more than you show. Favour long, rolling sentences with a formal, slightly archaic register, broken by a sudden short line. Give objects and places a sense of memory and threat. Keep characters isolated and uncertain of what is real. Avoid modern slang.",
    samples: ["The archive had not been opened in forty winters, and it remembered every one of them. Damp had crept into the ledgers and swollen them like drowned things; the shelves leaned together as if conferring in whispers. Mira's candle made a small, frightened circle of light. Beyond it, something in the dark shifted its weight. She did not turn around."]
  },
  {
    id: "builtin:lyrical",
    language: "en",
    name: "Lyrical",
    description: "Musical prose, rich imagery and inner life; sentences that linger.",
    guidance: "Let sentences flow and carry rhythm; read them aloud in your head. Use fresh, precise images drawn from the senses, and let one image echo through a passage. Move freely into a character's thoughts and memories. Allow quiet moments to breathe. Keep the language clear underneath the music: no image should hide what is happening.",
    samples: ["Morning came to Vell the way the tide did, slowly and then all at once, silvering the stairs and the wet slate roofs and the backs of the gulls. Mira watched it from the window with the map still warm under her hands, and thought of her sister's handwriting, the way the letters leaned forward as if hurrying somewhere she could not follow."]
  },
  {
    id: "builtin:hardboiled",
    language: "en",
    name: "Hard-boiled",
    description: "A tough, wry voice; terse lines and street-level detail.",
    guidance: "Write in a dry, world-weary voice, close in on one character (in the first person only when the story is already told that way). Use clipped sentences, sharp similes taken from everyday life, and understatement. Dialogue is quick, guarded and often sideways. Notice money, weather, bruises and who is lying. Keep emotion under the surface; let a wry line do the work of a confession.",
    samples: ["The warden had the kind of smile they hand out with the uniform. \"Nice map,\" he said. \"Yours?\" \"I just hold it for the view.\" He didn't laugh, which was fair; it wasn't funny. Rain was coming in sideways off the harbour and my last coin was in his pocket now. Some nights the city takes. Some nights it takes more."]
  },
  {
    id: "builtin:early-modern",
    language: "en",
    name: "Early Modern (Shakespearean)",
    description: "The cadence and vocabulary of English around 1600: thee and thou, inverted order, rich figures of speech.",
    guidance: "Write in Early Modern English: thou/thee/thy for familiar address, you for formal; verb endings such as -est and -eth; occasional inverted word order. Use rich figures of speech, wordplay and rhetorical questions. Keep it readable for a modern reader: clear syntax, no obscure words without context. Do not imitate verse unless asked; prose is the default.",
    samples: ["\"Why dost thou hold that map as though it were thy heart?\" quoth Kael. \"Because, sirrah, it hath more truth in it than thou hast spoken all this night.\" She laid it down upon the board. \"Look thou upon this coast and tell me, if thou canst, whose hand did draw it.\""]
  },
  {
    id: "builtin:baimiao",
    language: "zh-CN",
    name: "白描",
    description: "用最简练的笔墨写人写事，不加修饰，让细节自己说话。",
    guidance: "多用短句和常用字，少用形容词和成语。通过动作、神态和具体细节写人物，不直接说出情绪。对话简短，少加说明。删去解释性的句子，相信读者能看懂。比喻要少而朴素。",
    samples: ["她把地图放在桌上。老陈没有伸手。门外过去一辆车，又过去一辆。\"你画的？\"他问。\"不是。\"她把手叠在膝上，免得他看见手在抖。灯快没油了，两个人谁也没起身去添。"]
  },
  {
    id: "builtin:zhanghui",
    language: "zh-CN",
    name: "章回体",
    description: "说书人的口吻，节奏明快，常以悬念收束，可用\"话说\"\"且说\"\"欲知后事如何\"。",
    guidance: "用说书人的叙述口吻，节奏明快，叙事为主。可以用\"话说\"\"且说\"\"只见\"\"但见\"等套语，偶尔插入评点。人物出场常有简短的形貌描写。段落结尾留下悬念，章末可用\"欲知后事如何，且听下回分解\"。语言浅近，半文半白，不要过于古奥。",
    samples: ["话说雾港这夜潮水不退，满港船只都泊在原处，动弹不得。且说林晚怀揣那张无名地图，一路奔到码头，但见灯火寥落，守卫三五成群，正挨船盘查。林晚心中暗暗叫苦。正是：前有铁链锁港口，后有追兵到门前。不知她如何脱身，且听下回分解。"]
  },
  {
    id: "builtin:wuxia",
    language: "zh-CN",
    name: "武侠",
    description: "江湖气概，招式与气势并重，快意恩仇。",
    guidance: "写出江湖气：人物言语干脆，重义气、讲恩怨。打斗写招式也写气势，动作描写简洁有力，节奏紧凑。环境常带古意：客栈、渡口、长街、风雨。可适度使用四字短语增加气势，但不要堆砌。",
    samples: ["码头上风紧，灯笼被吹得乱晃。三名守卫拔刀围上，林晚不退反进，侧身让过当先一刀，手中铜规顺势一挑，正点在对方腕上。那人吃痛松手，钢刀当啷落地。余下二人对视一眼，竟不敢再上前。林晚冷冷道：\"让路。\""]
  },
  {
    id: "builtin:sanwen",
    language: "zh-CN",
    name: "散文化",
    description: "抒情、舒缓，重意象和内心感受，句子有韵律。",
    guidance: "节奏舒缓，句子讲究韵律，可长短交错。多写感官细节和意象，让一个意象在段落里反复回响。可以自由进入人物的回忆和思绪。情感含蓄而饱满，不要直白喊出来。语言清澈，意象不能遮住正在发生的事。",
    samples: ["清晨的雾港是慢慢醒来的，像潮水一样，先是石阶，再是湿漉漉的屋顶，最后是海鸥灰白的背。林晚站在窗前，手心里的地图还带着体温。她想起妹妹的字，每一笔都向前倾着，像是急着赶去一个她追不上的地方。"]
  }
]);

const clean = (value, limit) => (typeof value === "string" ? value.trim().replace(/[ \t]+/g, " ").slice(0, limit) : "");

function normalizeStyle(raw, { source = "user" } = {}) {
  const value = raw && typeof raw === "object" ? raw : {};
  const samples = (Array.isArray(value.samples) ? value.samples : []).map((item) => clean(item, MAX.sample)).filter(Boolean).slice(0, MAX.samples);
  return {
    id: typeof value.id === "string" ? value.id : "",
    language: value.language === "en" ? "en" : "zh-CN",
    name: clean(value.name, MAX.name),
    description: clean(value.description, MAX.description),
    guidance: clean(value.guidance, MAX.guidance),
    samples,
    source,
    revision: Number.isInteger(value.revision) && value.revision > 0 ? value.revision : 0,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : ""
  };
}

/** Built-in styles for a story language. */
function builtinStyles(language) {
  const lang = language === "en" ? "en" : "zh-CN";
  return BUILTIN_STYLES.filter((style) => style.language === lang).map((style) => normalizeStyle(style, { source: "builtin" }));
}

/** A style by id, from the built-ins or the writer's own; null when there is none. */
function findStyle(styleId, userStyles = []) {
  if (!styleId) return null;
  const builtin = BUILTIN_STYLES.find((style) => style.id === styleId);
  if (builtin) return normalizeStyle(builtin, { source: "builtin" });
  const own = userStyles.find((style) => style.id === styleId);
  return own ? normalizeStyle(own, { source: own.source === "imported" ? "imported" : "user" }) : null;
}

/** The part of a writing prompt that carries the style, in the story's language. */
function styleInstruction(style, english) {
  if (!style || !style.guidance) return "";
  const samples = style.samples.map((sample, index) => (english ? `Sample ${index + 1}:\n${sample}` : `示范 ${index + 1}：\n${sample}`)).join("\n\n");
  return (english ? [
    `Writing style: ${style.name}${style.description ? ` (${style.description})` : ""}`,
    `How to write: ${style.guidance}`,
    samples ? `Samples of the style (imitate the manner only; never copy their words, people or events):\n${samples}` : "",
    "The style changes only how the passage is told: keep every event, fact and character exactly as the request and the story say, and keep the story's point of view and tense (who tells it, and when)."
  ] : [
    `写作风格：${style.name}${style.description ? `（${style.description}）` : ""}`,
    `写法要点：${style.guidance}`,
    samples ? `风格示范（只学写法，不要照搬其中的字句、人物或情节）：\n${samples}` : "",
    "风格只改变讲法：事件、事实和人物必须与要求和作品设定完全一致，叙述视角和时态（谁在讲、何时讲）也要保持不变。"
  ]).filter(Boolean).join("\n");
}

/** The story's chosen style id; "" for none. */
function storyStyleId(work) {
  const value = work?.writingStyle && typeof work.writingStyle === "object" ? work.writingStyle.styleId : "";
  return typeof value === "string" ? value : "";
}

function setStoryStyle(work, styleId, userStyles, now) {
  const id = typeof styleId === "string" ? styleId : "";
  if (id && !findStyle(id, userStyles)) throw appError("STYLE_NOT_FOUND");
  work.writingStyle = { styleId: id, updatedAt: now };
  return work.writingStyle;
}

module.exports = { BUILTIN_STYLES, MAX_STYLE: MAX, normalizeStyle, builtinStyles, findStyle, styleInstruction, storyStyleId, setStoryStyle };
