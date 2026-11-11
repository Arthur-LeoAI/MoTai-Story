const crypto = require("crypto");

const STORY_BIBLE_FIELDS = [
  "logline",
  "theme",
  "tone",
  "genrePositioning",
  "worldview",
  "rules",
  "era",
  "characters",
  "relationships",
  "factions",
  "locations",
  "conflict",
  "antagonistPressure",
  "keyEvents",
  "foreshadowing",
  "continuityNotes",
  "outline",
  "chapterPlan"
];

const COVER_STYLE_PALETTES = new Set(["gold", "teal", "rose", "ink"]);
const COVER_TITLE_ALIGNMENTS = new Set(["left", "center"]);

function createId(prefix) {
  const id = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString("hex");
  return `${prefix}_${id.replace(/-/g, "").slice(0, 12)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, number));
}

function countCharacters(text) {
  return String(text || "")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\s/g, "")
    .length;
}

function getWorkStats(work) {
  const chapters = Array.isArray(work?.chapters) ? work.chapters : [];
  const totalCharacters = chapters.reduce((sum, chapter) => sum + countCharacters(chapter.content), 0);
  const completedChapters = chapters.filter((chapter) => chapter.status === "done").length;

  return {
    totalCharacters,
    chapterCount: chapters.length,
    completedChapters,
    progress: work?.targetCharacters
      ? Math.min(100, Math.round((totalCharacters / work.targetCharacters) * 100))
      : 0
  };
}

function emptyStoryBible() {
  return Object.fromEntries(STORY_BIBLE_FIELDS.map((field) => [field, ""]));
}

function normalizeStoryBible(value) {
  const storyBible = emptyStoryBible();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return storyBible;
  }

  for (const field of STORY_BIBLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      continue;
    }
    storyBible[field] = typeof value[field] === "string"
      ? value[field].trim()
      : JSON.stringify(value[field] ?? "", null, 2);
  }

  return storyBible;
}

function normalizeCoverStyle(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    palette: COVER_STYLE_PALETTES.has(source.palette) ? source.palette : "gold",
    titleAlign: COVER_TITLE_ALIGNMENTS.has(source.titleAlign) ? source.titleAlign : "left",
    showTitle: source.showTitle !== false,
    showMetadata: source.showMetadata !== false,
    showLogline: source.showLogline !== false,
    showAuthor: source.showAuthor !== false
  };
}

function normalizeChapterPlanning(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    goal: normalizeText(source.goal),
    scene: normalizeText(source.scene),
    characters: normalizeText(source.characters),
    conflict: normalizeText(source.conflict),
    hook: normalizeText(source.hook)
  };
}

function isStoryBibleEmpty(storyBible) {
  return !Object.values(normalizeStoryBible(storyBible)).some((value) => value.trim());
}

function getWorkBoldness(work) {
  return clampNumber(work?.boldness, 0, 100, 50);
}

function temperatureFromBoldness(value) {
  return Number((0.35 + (clampNumber(value, 0, 100, 50) / 100) * 0.9).toFixed(2));
}

function getBoldnessLabel(value) {
  const boldness = clampNumber(value, 0, 100, 50);
  if (boldness <= 30) {
    return "稳妥：严格贴合设定，少反转。";
  }
  if (boldness >= 71) {
    return "大胆：允许更强反转、更奇特设定和更主动的冲突升级，但不能推翻核心设定。";
  }
  return "平衡：有新意，但不乱改核心。";
}

function getWorkTextBag(work) {
  const storyBible = normalizeStoryBible(work?.storyBible);
  return [
    work?.title,
    work?.premise,
    work?.genre,
    Array.isArray(work?.tags) ? work.tags.join(" ") : "",
    work?.notes,
    ...Object.values(storyBible)
  ].join("\n");
}

// The language a story is written in. Independent of the interface language.
// Works created before this field existed were all written in Chinese, so they
// read as "zh-CN".
const STORY_LANGUAGES = Object.freeze(["en", "zh-CN"]);
const LEGACY_STORY_LANGUAGE = "zh-CN";

function normalizeStoryLanguage(value, fallback = LEGACY_STORY_LANGUAGE) {
  return STORY_LANGUAGES.includes(value) ? value : fallback;
}

function workSummary(work) {
  return {
    id: work.id,
    title: work.title,
    language: normalizeStoryLanguage(work.language),
    author: normalizeText(work.author) || "未署名",
    premise: work.premise,
    genre: work.genre,
    status: work.status,
    tags: work.tags || [],
    targetCharacters: work.targetCharacters || 0,
    boldness: getWorkBoldness(work),
    storyBible: normalizeStoryBible(work.storyBible),
    coverStyle: normalizeCoverStyle(work.coverStyle),
    coverLogline: normalizeText(work.coverLogline),
    cover: work.cover || "/assets/writing-workspace.png",
    createdAt: work.createdAt,
    updatedAt: work.updatedAt,
    stats: getWorkStats(work)
  };
}

function findWork(db, workId) {
  return db.works.find((work) => work.id === workId);
}

function findChapter(work, chapterId) {
  return (work.chapters || []).find((chapter) => chapter.id === chapterId);
}

module.exports = {
  COVER_STYLE_PALETTES,
  STORY_LANGUAGES,
  STORY_BIBLE_FIELDS,
  clampNumber,
  countCharacters,
  createId,
  emptyStoryBible,
  findChapter,
  findWork,
  getBoldnessLabel,
  getWorkBoldness,
  getWorkStats,
  getWorkTextBag,
  isStoryBibleEmpty,
  normalizeStoryBible,
  normalizeChapterPlanning,
  normalizeCoverStyle,
  normalizeStoryLanguage,
  normalizeText,
  nowIso,
  temperatureFromBoldness,
  workSummary
};
