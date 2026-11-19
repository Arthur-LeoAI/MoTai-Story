const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "variants-"));
process.env.DATA_FILE = path.join(dir, "db.json");
process.env.ENV_FILE = path.join(dir, ".env");
process.env.MOTAI_TEST_AI = "1";

const variants = require("../src/variants");
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

const work = { language: "en", title: "The Cartographer's Sister" };
const passage = "She was angry. She left the room.";

test("by default the three ways are tenser, richer and leaner, and keep every event", () => {
  const { ways, spec } = variants.variantsRequest(work, { passage, before: "Kael laughed at the map.", after: "Outside, it was raining." });
  assert.deepEqual(ways.map((way) => way.label), ["Tenser", "Richer", "Leaner"]);
  assert.ok(spec.prompt.includes("The passage to rewrite:\nShe was angry. She left the room."));
  assert.ok(spec.prompt.includes("What comes just before (for continuity; do not rewrite it):\nKael laughed at the map."));
  assert.match(spec.prompt, /exactly the same events, in the same order, with the same people, names, facts and meaning of every line of dialogue, from the same point of view and in the same tense/);
  assert.ok(!spec.prompt.includes("why it works"), "no explanations unless asked");
  assert.equal(spec.properties.versions.items.properties.why, undefined);
  assert.throws(() => variants.variantsRequest(work, { passage: "  " }), { code: "VARIANT_PASSAGE_REQUIRED" });
  assert.deepEqual(variants.variantsRequest({ language: "zh-CN" }, { passage: "她很生气。" }).ways.map((way) => way.label), ["更紧张", "更细腻", "更简洁"]);
});

test("three styles can be compared instead, and 'why' is asked for only when wanted", () => {
  const chosen = ["builtin:plain", "builtin:gothic", "builtin:hardboiled"].map((id) => styles.findStyle(id));
  const { ways, spec } = variants.variantsRequest(work, { passage, explain: true }, { styles: chosen });
  assert.deepEqual(ways.map((way) => way.label), ["Plain and spare", "Gothic", "Hard-boiled"]);
  assert.match(spec.prompt, /Version 2, in the style "Gothic":\nWriting style: Gothic/);
  assert.match(spec.prompt, /as a writing teacher would to a beginner/);
  assert.deepEqual(spec.properties.versions.items.required, ["text", "why"]);
  // The story's own style sits underneath the three angles.
  const withStory = variants.variantsRequest(work, { passage }, { storyStyle: styles.findStyle("builtin:lyrical") });
  assert.match(withStory.spec.prompt, /The story's own style, which every version keeps underneath:\nWriting style: Lyrical/);
  // A missing version is an empty answer.
  assert.throws(() => variants.normalizeVariants({ versions: [{ text: "a" }, { text: "b" }] }, ways, false), { code: "AI_ARTIFACT_EMPTY" });
  assert.deepEqual(variants.normalizeVariants({ versions: [{ text: "a", why: " w " }, { text: "b\\nc" }, { text: "d" }] }, ways, true).map((item) => [item.label, item.text, item.why]), [
    ["Plain and spare", "a", "w"], ["Gothic", "b\nc", ""], ["Hard-boiled", "d", ""]
  ]);
});

test("HTTP: three versions come back and nothing in the story changes", async () => {
  const { body: { work: created } } = await call("/api/works", "POST", { title: "Ways", language: "en", focus: "write" });
  const before = (await call(`/api/works/${created.id}`)).body.work;
  const angles = await call(`/api/works/${created.id}/variants`, "POST", { passage });
  assert.equal(angles.status, 200);
  assert.deepEqual(angles.body.variants.map((item) => item.label), ["Tenser", "Richer", "Leaner"]);
  assert.equal(angles.body.variants[0].why, undefined);
  const explained = await call(`/api/works/${created.id}/variants`, "POST", { passage, explain: true, styleIds: ["builtin:plain", "builtin:gothic", "builtin:dramatic"] });
  assert.deepEqual(explained.body.variants.map((item) => item.label), ["Plain and spare", "Gothic", "Dramatic"]);
  assert.ok(explained.body.variants.every((item) => item.why));
  assert.equal((await call(`/api/works/${created.id}/variants`, "POST", { passage, styleIds: ["builtin:nope"] })).body.error.code, "STYLE_NOT_FOUND");
  assert.equal((await call(`/api/works/${created.id}/variants`, "POST", { passage: "" })).body.error.code, "VARIANT_PASSAGE_REQUIRED");
  const after = (await call(`/api/works/${created.id}`)).body.work;
  assert.equal(after.rowVersion, before.rowVersion);
});
