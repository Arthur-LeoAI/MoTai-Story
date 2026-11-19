"use strict";
const { appError } = require("./errors");
const { styleInstruction } = require("./styles");

// "Three ways" (plan 5.9 C): three versions of a passage the writer selected,
// side by side. By default the three take different angles (tenser, richer,
// leaner); the writer may instead compare three writing styles. With
// "explain" on (plan 5.9, "why it's written this way"), each version says in
// a sentence or two what it did, in plain words. Nothing is saved here: the
// writer picks a version in the editor, and undo brings the original back.

const MAX_PASSAGE = 4000;
const MAX_AROUND = 1500;
const ANGLES = {
  en: [
    { key: "tenser", label: "Tenser", how: "raise the tension: tighter rhythm, sharper verbs, more at stake in each line" },
    { key: "richer", label: "Richer", how: "give it more texture: sensory detail, inner life and atmosphere, without padding" },
    { key: "leaner", label: "Leaner", how: "cut it down: keep only what carries the scene, in fewer and plainer words" }
  ],
  zh: [
    { key: "tenser", label: "更紧张", how: "加强张力：节奏更紧，动词更有力，每一句都更有分量" },
    { key: "richer", label: "更细腻", how: "写得更丰富：感官细节、内心活动和氛围，但不要注水" },
    { key: "leaner", label: "更简洁", how: "删繁就简：只留下撑起这场戏的内容，用更少、更平实的字" }
  ]
};

const clean = (value, limit) => (typeof value === "string" ? value.replace(/\r/g, "").trim().slice(0, limit) : "");
const tail = (value, limit) => (typeof value === "string" ? value.replace(/\r/g, "").slice(-limit).trim() : "");
const head = (value, limit) => (typeof value === "string" ? value.replace(/\r/g, "").slice(0, limit).trim() : "");

/** The three ways to ask for: angles, or the writer's three styles. */
function plan(body, styles, english) {
  if (styles.length) return styles.slice(0, 3).map((style) => ({ key: style.id, label: style.name, style }));
  return (english ? ANGLES.en : ANGLES.zh).map((angle) => ({ ...angle }));
}

function variantsRequest(work, body, { styles = [], storyStyle = null } = {}) {
  const english = work?.language === "en";
  const passage = clean(body?.passage, MAX_PASSAGE);
  if (!passage) throw appError("VARIANT_PASSAGE_REQUIRED");
  const ways = plan(body, styles, english);
  const explain = body?.explain === true;
  const before = tail(body?.before, MAX_AROUND);
  const after = head(body?.after, MAX_AROUND);
  const describe = (way, index) => (way.style
    ? (english ? `Version ${index + 1}, in the style "${way.label}":\n${styleInstruction(way.style, true)}` : `第 ${index + 1} 版，用"${way.label}"风格：\n${styleInstruction(way.style, false)}`)
    : (english ? `Version ${index + 1} (${way.label}): ${way.how}.` : `第 ${index + 1} 版（${way.label}）：${way.how}。`));
  const base = !styles.length && storyStyle ? styleInstruction(storyStyle, english) : "";
  const prompt = (english ? [
    "Rewrite one passage of a novel in three different ways, for the author to compare side by side.",
    `Story: "${work?.title || "Untitled story"}"`,
    base ? `The story's own style, which every version keeps underneath:\n${base}` : "",
    before ? `What comes just before (for continuity; do not rewrite it):\n${before}` : "",
    `The passage to rewrite:\n${passage}`,
    after ? `What comes just after (for continuity; do not rewrite it):\n${after}` : "",
    ways.map(describe).join("\n\n"),
    "Every version tells exactly the same events, in the same order, with the same people, names, facts and meaning of every line of dialogue, from the same point of view and in the same tense as the passage; only the telling changes. Each version must read on smoothly from what comes before and into what comes after. Make the three clearly different from each other. Return only the rewritten passage in each, with no headings or notes inside it.",
    explain ? "For each version, also say in one or two plain sentences what you changed and why it works, as a writing teacher would to a beginner (for example: \"Turned 'she was angry' into the slammed door, so the reader sees it for themselves\"). Name the technique only in everyday words." : "",
    "Write in English."
  ] : [
    "把小说中的一段文字用三种不同的方式改写，供作者并排比较。",
    `作品：《${work?.title || "未命名作品"}》`,
    base ? `作品本身的风格，每一版都要保持：\n${base}` : "",
    before ? `紧接在前面的文字（用于衔接，不要改写）：\n${before}` : "",
    `要改写的段落：\n${passage}`,
    after ? `紧接在后面的文字（用于衔接，不要改写）：\n${after}` : "",
    ways.map(describe).join("\n\n"),
    "每一版讲述的事件、顺序、人物、名字、事实和每句对白的意思都必须完全相同，叙述视角和时态也与原段落相同，只改变讲法。每一版都要能和前后文自然衔接。三版之间要有明显的不同。每一版只写改写后的段落，不要加标题或说明。",
    explain ? "每一版另外用一两句平实的话说明改了什么、为什么有效，就像写作老师给初学者讲解（例如：\"把'她很生气'改成了摔门的动作，让读者自己看出来\"）。用日常的话说技巧，不用术语。" : "",
    "用简体中文。"
  ]).filter(Boolean).join("\n\n");
  return {
    ways,
    spec: {
      toolName: "three_ways",
      description: english ? "Three versions of a passage" : "一段文字的三个版本",
      system: english ? "You help a novelist try a passage three ways. Return the versions through the given tool." : "你帮助小说作者用三种方式尝试一段文字。请通过指定工具返回各个版本。",
      prompt,
      properties: {
        versions: {
          type: "array",
          description: english ? "Exactly three versions, in the order asked" : "按要求的顺序，正好三个版本",
          items: {
            type: "object",
            properties: {
              text: { type: "string", description: english ? "The rewritten passage" : "改写后的段落" },
              ...(explain ? { why: { type: "string", description: english ? "One or two plain sentences on what changed and why" : "一两句话：改了什么、为什么" } } : {})
            },
            required: explain ? ["text", "why"] : ["text"]
          }
        }
      },
      required: ["versions"]
    }
  };
}

function normalizeVariants(raw, ways, explain) {
  const items = Array.isArray(raw?.versions) ? raw.versions : [];
  const variants = ways.map((way, index) => {
    const item = items[index] && typeof items[index] === "object" ? items[index] : {};
    const text = clean(typeof item.text === "string" ? item.text.replace(/\\n/g, "\n") : "", MAX_PASSAGE * 2);
    return { key: way.key, label: way.label, text, ...(explain ? { why: clean(item.why, 600) } : {}) };
  });
  if (variants.some((variant) => !variant.text)) throw appError("AI_ARTIFACT_EMPTY");
  return variants;
}

/** Built-in test AI: each way marks the passage so a test can tell them apart. */
function testVariants(ways, body) {
  const passage = clean(body?.passage, MAX_PASSAGE);
  if (!passage) throw appError("VARIANT_PASSAGE_REQUIRED");
  const explain = body?.explain === true;
  return normalizeVariants({ versions: ways.map((way) => ({ text: `${passage} (${way.label})`, why: `The ${way.label} version.` })) }, ways, explain);
}

module.exports = { variantsRequest, normalizeVariants, testVariants, ANGLES };
