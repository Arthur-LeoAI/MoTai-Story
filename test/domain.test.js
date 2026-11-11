const test = require("node:test");
const assert = require("node:assert/strict");

const {
  clampNumber,
  countCharacters,
  emptyStoryBible,
  getWorkBoldness,
  getWorkStats,
  normalizeStoryBible,
  temperatureFromBoldness,
  workSummary
} = require("../src/domain");

test("numeric helpers keep boldness inside the supported range", () => {
  assert.equal(clampNumber("72", 0, 100, 50), 72);
  assert.equal(getWorkBoldness({ boldness: 200 }), 100);
  assert.equal(getWorkBoldness({ boldness: "invalid" }), 50);
  assert.equal(temperatureFromBoldness(0), 0.35);
  assert.equal(temperatureFromBoldness(100), 1.25);
});

test("story bible normalization is backward compatible", () => {
  const empty = emptyStoryBible();
  const normalized = normalizeStoryBible({
    logline: "  一次跨越星海的追寻  ",
    characters: [{ name: "林川" }],
    unknownField: "ignored"
  });

  assert.deepEqual(Object.keys(normalized), Object.keys(empty));
  assert.equal(normalized.logline, "一次跨越星海的追寻");
  assert.match(normalized.characters, /林川/);
  assert.equal(Object.hasOwn(normalized, "unknownField"), false);
});

test("work summary calculates chapter progress without exposing chapter bodies", () => {
  const work = {
    id: "work_test",
    title: "星港来信",
    targetCharacters: 10,
    chapters: [
      { content: "一 二 三", status: "done" },
      { content: "四\n五", status: "draft" }
    ]
  };

  assert.equal(countCharacters("一 二\n三"), 3);
  assert.deepEqual(getWorkStats(work), {
    totalCharacters: 5,
    wordCount: 5,
    wordUnit: "characters",
    chapterCount: 2,
    completedChapters: 1,
    progress: 50
  });

  const summary = workSummary(work);
  assert.equal(summary.stats.totalCharacters, 5);
  assert.equal(Object.hasOwn(summary, "chapters"), false);
});
