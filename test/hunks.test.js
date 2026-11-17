const test = require("node:test");
const assert = require("node:assert/strict");
const { makeHunks, mergeHunks } = require("../src/workspace");

const chapter = (text) => ({ richContent: { ops: [{ insert: text }] } });
const merged = (source, range, output, pick) => {
  const hunks = makeHunks(source, range, output);
  const ids = pick ? pick.map((index) => hunks[index].id) : hunks.map((hunk) => hunk.id);
  return mergeHunks(source, hunks, ids).ops.map((op) => op.insert).join("");
};

test("an insertion becomes one change per paragraph, without blank-line changes", () => {
  const hunks = makeHunks(chapter("First line.\n"), { index: 11, length: 0 }, "A one.\n\nB two.\n\n\nC three.\n");
  assert.deepEqual(hunks.map((hunk) => hunk.after), ["\nA one.", "\nB two.", "\nC three."]);
  assert.ok(hunks.every((hunk) => hunk.index === 11 && hunk.length === 0 && hunk.before === ""));
});

test("any choice of inserted paragraphs still reads as whole paragraphs", () => {
  const source = chapter("First line.\nLast line.\n");
  const output = "A one.\n\nB two.\n\nC three.";
  // After the end of a line of text: a new paragraph, never glued to that line.
  assert.equal(merged(source, { index: 11, length: 0 }, output), "First line.\nA one.\nB two.\nC three.\nLast line.\n");
  assert.equal(merged(source, { index: 11, length: 0 }, output, [1]), "First line.\nB two.\nLast line.\n");
  assert.equal(merged(source, { index: 22, length: 0 }, output, [0, 2]), "First line.\nLast line.\nA one.\nC three.\n");
  // At the start of a line: the paragraphs come before it.
  assert.equal(merged(source, { index: 12, length: 0 }, output, [0, 2]), "First line.\nA one.\nC three.\nLast line.\n");
});

test("replacing a selection keeps the existing paragraph-by-paragraph comparison", () => {
  const source = chapter("One.\nTwo.\n");
  const hunks = makeHunks(source, { index: 0, length: 9 }, "One.\nTwo, better.");
  assert.deepEqual(hunks.map((hunk) => [hunk.before, hunk.after]), [["Two.", "Two, better."]]);
});

test("a long insertion is one change rather than a long list of paragraphs", () => {
  const output = Array.from({ length: 12 }, (_, index) => `Paragraph ${index + 1}.`).join("\n\n");
  const hunks = makeHunks(chapter("First line.\n"), { index: 11, length: 0 }, output);
  assert.equal(hunks.length, 1);
  assert.equal(merged(chapter("First line.\n"), { index: 11, length: 0 }, output), `First line.\n${Array.from({ length: 12 }, (_, index) => `Paragraph ${index + 1}.`).join("\n")}\n`);
});
