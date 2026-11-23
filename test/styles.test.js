const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "styles-"));
process.env.DATA_FILE = path.join(dir, "db.json");
process.env.ENV_FILE = path.join(dir, ".env");
process.env.MOTAI_TEST_AI = "1";

const styles = require("../src/styles");
const { createAppServer } = require("../server");

const server = createAppServer();
let base;
test.before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fsp.rm(dir, { recursive: true, force: true });
});

async function call(url, method = "GET", data) {
  const response = await fetch(base + url, { method, headers: { "Content-Type": "application/json" }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const text = await response.text();
  return { status: response.status, body: text.startsWith("{") ? JSON.parse(text) : text };
}

test("each story language has its own built-in styles, each with guidance and a sample", () => {
  const english = styles.builtinStyles("en");
  const chinese = styles.builtinStyles("zh-CN");
  assert.deepEqual(english.map((style) => style.name), ["Plain and spare", "Dramatic", "Gothic", "Lyrical", "Hard-boiled", "Early Modern (Shakespearean)"]);
  assert.deepEqual(chinese.map((style) => style.name), ["白描", "章回体", "武侠", "散文化"]);
  for (const style of [...english, ...chinese]) {
    assert.ok(style.id.startsWith("builtin:"));
    assert.equal(style.source, "builtin");
    assert.ok(style.guidance.length > (style.language === "en" ? 200 : 60), style.name);
    assert.equal(style.samples.length, 1, style.name);
  }
  assert.equal(new Set(styles.BUILTIN_STYLES.map((style) => style.id)).size, styles.BUILTIN_STYLES.length);
});

test("a style reaches the prompt as how to write, never as what happens", () => {
  const plain = styles.findStyle("builtin:plain");
  const text = styles.styleInstruction(plain, true);
  assert.match(text, /^Writing style: Plain and spare \(Short, concrete sentences/);
  assert.match(text, /How to write: Use short declarative sentences/);
  assert.match(text, /imitate the manner only; never copy their words, people or events/);
  assert.match(text, /keep every event, fact and character exactly as the request and the story say, and keep the story's point of view and tense/);
  assert.match(styles.styleInstruction(styles.findStyle("builtin:baimiao"), false), /^写作风格：白描/);
  assert.equal(styles.styleInstruction(null, true), "");
  assert.equal(styles.findStyle("builtin:missing"), null);
  // The writer's own styles are found too.
  assert.equal(styles.findStyle("style_1", [{ id: "style_1", language: "en", name: "Mine", guidance: "Short." }]).name, "Mine");
});

test("HTTP: styles are listed for the story's language, and a story keeps its default style", async () => {
  const english = await call("/api/styles?language=en");
  assert.equal(english.status, 200);
  assert.equal(english.body.styles.length, 6);
  assert.equal((await call("/api/styles?language=zh-CN")).body.styles[0].name, "白描");

  const { body: { work } } = await call("/api/works", "POST", { title: "Styles", language: "en", focus: "write" });
  assert.equal((await call(`/api/works/${work.id}/style`)).body.styleId, "");
  const set = await call(`/api/works/${work.id}/style`, "PUT", { styleId: "builtin:gothic" });
  assert.equal(set.status, 200);
  assert.equal((await call(`/api/works/${work.id}/style`)).body.styleId, "builtin:gothic");
  const missing = await call(`/api/works/${work.id}/style`, "PUT", { styleId: "builtin:nope" });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, "STYLE_NOT_FOUND");
  assert.equal((await call(`/api/works/${work.id}/style`, "PUT", { styleId: "" })).body.styleId, "");
});

const drafts = require("../src/user-styles");

test("a style drafted from a passage describes how it is written, and never keeps the passage", () => {
  const passage = "The rain had come down for three days, and on the fourth the river took the bridge at Hollin and the miller's boy with it, and nobody in the village spoke of it again.";
  const request = drafts.draftRequest({ language: "en", passage });
  assert.ok(request.prompt.includes(passage));
  assert.match(request.prompt, /do not quote it, do not name or guess its author, and do not mention its people, places or events/);
  assert.match(request.prompt, /never a person's name/);
  assert.match(request.prompt, /about a different subject/);
  assert.throws(() => drafts.draftRequest({ language: "en" }), { code: "STYLE_SOURCE_REQUIRED" });
  assert.match(drafts.draftRequest({ language: "zh-CN", description: "冷静克制" }).prompt, /用简体中文/);
  // A sample that copies eight words of the passage in a row is dropped.
  const copied = drafts.normalizeDraft({ name: "Long and flowing", description: "x", guidance: "Long sentences joined by and.", sample: "Then on the fourth the river took the bridge at Hollin and the miller's boy." }, { language: "en", passage });
  assert.deepEqual(copied.samples, []);
  const fresh = drafts.normalizeDraft({ name: "Long and flowing", description: "x", guidance: "Long sentences joined by and.", sample: "The snow kept on through the night, and by morning the road to the mill was gone." }, { language: "en", passage });
  assert.equal(fresh.samples.length, 1);
  // A line break written as the two characters "\n" becomes a real one.
  assert.equal(drafts.normalizeDraft({ name: "冷刃", guidance: "短句。", sample: "门开了。\\n\\n“找人？”" }, { language: "zh-CN" }).samples[0], "门开了。\n\n“找人？”");
});

test("HTTP: the writer's own styles are kept per writer, used in their stories, exported and imported", async () => {
  const empty = await call("/api/me/styles");
  assert.deepEqual(empty.body.styles, []);
  assert.equal((await call("/api/me/styles", "POST", { language: "en", name: "", guidance: "x" })).body.error.code, "STYLE_NAME_REQUIRED");
  assert.equal((await call("/api/me/styles", "POST", { language: "en", name: "Mine", guidance: "" })).body.error.code, "STYLE_GUIDANCE_REQUIRED");

  const drafted = await call("/api/me/styles/draft", "POST", { language: "en", description: "quiet, close to one person" });
  assert.equal(drafted.status, 200);
  assert.equal((await call("/api/me/styles")).body.styles.length, 0, "a draft is not saved");

  const created = await call("/api/me/styles", "POST", drafted.body.draft);
  assert.equal(created.status, 201);
  const mine = created.body.style;
  assert.equal(mine.source, "user");
  assert.equal(mine.revision, 1);
  // It is offered for stories in its language only.
  assert.ok((await call("/api/styles?language=en")).body.styles.some((style) => style.id === mine.id));
  assert.ok(!(await call("/api/styles?language=zh-CN")).body.styles.some((style) => style.id === mine.id));
  const { body: { work } } = await call("/api/works", "POST", { title: "Mine", language: "en", focus: "write" });
  assert.equal((await call(`/api/works/${work.id}/style`, "PUT", { styleId: mine.id })).body.styleId, mine.id);

  const changed = await call(`/api/me/styles/${mine.id}`, "PUT", { name: "Quieter", baseRevision: 1 });
  assert.equal(changed.body.style.name, "Quieter");
  assert.equal(changed.body.style.guidance, mine.guidance);
  assert.equal((await call(`/api/me/styles/${mine.id}`, "PUT", { name: "Stale", baseRevision: 1 })).body.error.code, "REVISION_CONFLICT");

  // An exported card comes back as an imported style with a new id.
  const imported = await call("/api/me/styles", "POST", { ...changed.body.style, id: "someone-elses-id", source: "imported" });
  assert.equal(imported.body.style.source, "imported");
  assert.notEqual(imported.body.style.id, "someone-elses-id");

  assert.equal((await call(`/api/me/styles/${mine.id}`, "DELETE", { baseRevision: 2 })).status, 200);
  assert.deepEqual((await call("/api/me/styles")).body.styles.map((style) => style.name), ["Quieter"]);
});
