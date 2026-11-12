const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foundation-api-"));
process.env.DATA_FILE = path.join(dir, "db.json");
process.env.ENV_FILE = path.join(dir, ".env");
process.env.MOTAI_TEST_AI = "1";

const { createAppServer } = require("../server");
const { AppError, ERROR_STATUS, appError, toErrorResponse } = require("../src/errors");
const { authenticate, assertOwner, LOCAL_USER } = require("../src/auth");
const { createJsonStore } = require("../src/storage");
const { createPreferenceRepository } = require("../src/preferences");
const brand = require("../shared/brand.json");

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
  const response = await fetch(base + url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(data === undefined ? {} : { body: typeof data === "string" ? data : JSON.stringify(data) })
  });
  return { status: response.status, body: await response.json() };
}

test("error catalog: every code has a status and an English message", () => {
  const en = require("../shared/locales/en.json").errors;
  for (const [code, status] of Object.entries(ERROR_STATUS)) {
    assert.ok(Number.isInteger(status), code);
    assert.ok(en[code], `missing English message for ${code}`);
  }
  assert.throws(() => appError("NOT_A_REAL_CODE"), TypeError);
});

test("errors serialize as { code, message, params } and hide unknown internals", () => {
  const known = toErrorResponse(appError("IMAGE_TOO_LARGE", { limitMb: 25 }));
  assert.equal(known.status, 413);
  assert.deepEqual(known.body, { error: { code: "IMAGE_TOO_LARGE", message: "The image cannot be larger than 25 MB.", params: { limitMb: 25 } } });

  const overridden = toErrorResponse(appError("AI_UPSTREAM_ERROR", { detail: "x" }, { status: 418 }));
  assert.equal(overridden.status, 418);

  const unknown = toErrorResponse(new Error("secret internal detail"));
  assert.equal(unknown.status, 500);
  assert.equal(unknown.body.error.code, "INTERNAL_ERROR");
  assert.doesNotMatch(JSON.stringify(unknown.body), /secret/);

  const legacy = toErrorResponse(Object.assign(new Error("anything"), { status: 404 }));
  assert.equal(legacy.body.error.code, "NOT_FOUND");
  assert.ok(appError("NOT_FOUND") instanceof AppError);
});

test("API errors use codes over HTTP", async () => {
  const missingRoute = await call("/api/does-not-exist/at-all");
  assert.equal(missingRoute.status, 404);
  assert.equal(missingRoute.body.error.code, "ROUTE_NOT_FOUND");

  const badJson = await call("/api/works", "POST", "{not json");
  assert.equal(badJson.status, 400);
  assert.equal(badJson.body.error.code, "INVALID_JSON");

  const missingWork = await call("/api/works/work_missing");
  assert.equal(missingWork.status, 404);
  assert.equal(missingWork.body.error.code, "WORK_NOT_FOUND");
});

test("auth entry point resolves the single development user", () => {
  assert.equal(authenticate({ headers: {} }).id, "local");
  assert.doesNotThrow(() => assertOwner(LOCAL_USER, { ownerId: "local" }));
  assert.doesNotThrow(() => assertOwner(LOCAL_USER, {}));
  assert.throws(() => assertOwner(LOCAL_USER, { ownerId: "someone-else" }), { code: "NOT_FOUND" });
  assert.throws(() => assertOwner(null, {}), { code: "AUTH_REQUIRED" });
});

test("session reports the user, codename and default preferences", async () => {
  const session = await call("/api/session");
  assert.equal(session.status, 200);
  assert.equal(session.body.user.id, "local");
  assert.equal(session.body.brand.codename, brand.codename);
  assert.equal(session.body.preferences.uiLocale, "en");
  assert.equal(session.body.preferences.theme, "paper");
});

test("preferences are validated, owned by the user and persisted through the store", async () => {
  const updated = await call("/api/me/preferences", "PATCH", { uiLocale: "zh-CN", theme: "candle" });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.preferences.uiLocale, "zh-CN");
  assert.equal(updated.body.preferences.theme, "candle");

  const again = await call("/api/me/preferences");
  assert.equal(again.body.preferences.uiLocale, "zh-CN");

  const invalid = await call("/api/me/preferences", "PATCH", { uiLocale: "xx" });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, "BAD_REQUEST");

  const unknownField = await call("/api/me/preferences", "PATCH", { admin: true });
  assert.equal(unknownField.status, 400);

  const wrongMethod = await call("/api/me/preferences", "DELETE");
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.body.error.code, "METHOD_NOT_ALLOWED");

  const stored = JSON.parse(await fsp.readFile(process.env.DATA_FILE, "utf8"));
  assert.equal(stored.userPreferences.local.ownerId, "local");
});

test("preference repository keeps users apart", async () => {
  const store = createJsonStore(path.join(dir, "prefs-only.json"));
  const prefs = createPreferenceRepository(store, { now: () => "2026-01-01T00:00:00.000Z" });
  await prefs.update("alice", { theme: "candle" });
  assert.equal((await prefs.get("alice")).theme, "candle");
  assert.equal((await prefs.get("bob")).theme, "paper");
  await assert.rejects(prefs.get(""), { code: "AUTH_REQUIRED" });
});

test("new works record their owner and story language separately from the interface language", async () => {
  const english = await call("/api/works", "POST", { title: "Ferry", language: "en" });
  assert.equal(english.status, 201);
  assert.equal(english.body.work.language, "en");
  const legacy = await call("/api/works", "POST", { title: "旧作" });
  assert.equal(legacy.body.work.language, "zh-CN");
  const stored = JSON.parse(await fsp.readFile(process.env.DATA_FILE, "utf8"));
  assert.equal(stored.works.find((work) => work.id === english.body.work.id).ownerId, "local");
});

test("shared locale files are served for the legacy frontend", async () => {
  const response = await fetch(`${base}/locales/zh-CN.json`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.errors.WORK_NOT_FOUND, "作品不存在。");
  assert.equal((await fetch(`${base}/locales/..%2Fbrand.json`)).status, 404);
});

test("every error helper call in the server uses a code from the catalog", () => {
  const files = ["server.js", ...fs.readdirSync(path.join(__dirname, "..", "src")).map((name) => path.join("src", name))];
  const unknown = [];
  let calls = 0;
  for (const file of files) {
    const text = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    // fail("…"), domainError("…"), invalid("…"), appError("…"), sendError(res, "…")
    for (const match of text.matchAll(/\b(?:fail|domainError|invalid|appError|sendError\(res,)\s*\(?\s*(["'`])([^"'`\n]*)\1/g)) {
      calls += 1;
      if (!Object.hasOwn(ERROR_STATUS, match[2])) unknown.push(`${file}: ${match[0]}`);
    }
  }
  assert.ok(calls > 100, `expected to scan the error calls, found ${calls}`);
  assert.deepEqual(unknown, []);
});

test("the desktop package ships the shared files the server loads at startup", () => {
  const packaged = require("../package.json").build.files;
  assert.ok(packaged.includes("shared/**"));
});

test("quota, conflict and validation guards answer with their own codes, not a 500", async () => {
  for (const code of ["WORK_UPDATED_ELSEWHERE", "SCENE_NEEDS_RELOCATION", "BACKUP_HISTORY_INVALID", "AI_DAILY_LIMIT_REACHED"]) {
    assert.equal(toErrorResponse(appError(code)).body.error.code, code);
  }
  assert.equal(toErrorResponse(appError("AI_DAILY_LIMIT_REACHED")).status, 429);
  const created = await call("/api/works", "POST", { title: "审校缺章" });
  const review = await call(`/api/works/${created.body.work.id}/chapters/chapter_missing/review`, "POST", { baseRevision: 0 });
  assert.notEqual(review.status, 500);
});

test("stories carry a focus, language-aware length and their last edited chapter", async () => {
  const shaped = await call("/api/works", "POST", { premise: "A mapmaker.", language: "en", focus: "shape" });
  assert.equal(shaped.status, 201);
  assert.equal(shaped.body.work.title, "Untitled story");
  assert.equal(shaped.body.work.chapters[0].title, "Chapter 1");
  const id = shaped.body.work.id;
  const chapter = shaped.body.work.chapters[0];

  const list = async () => (await call("/api/works")).body.works.find((work) => work.id === id);
  let summary = await list();
  assert.equal(summary.focus, "shape");
  assert.equal(summary.stats.wordUnit, "words");
  assert.equal(summary.stats.wordCount, 0);
  assert.deepEqual(summary.lastEditedChapter, { id: chapter.id, title: "Chapter 1", number: 1 });

  const saved = await call(`/api/works/${id}/chapters/${chapter.id}`, "PATCH", { baseRevision: chapter.revision, content: "The ferry had no bell." });
  assert.equal(saved.status, 200);
  summary = await list();
  assert.equal(summary.stats.wordCount, 5);
  assert.equal(summary.focus, "shape", "an explicit choice is kept even once there is text");

  const switched = await call(`/api/works/${id}`, "PATCH", { focus: "write" });
  assert.equal(switched.status, 200);
  assert.equal((await list()).focus, "write");
  assert.equal((await call(`/api/works/${id}`, "PATCH", { focus: "everything" })).body.error.code, "BAD_REQUEST");
  assert.equal((await call(`/api/works/${id}`, "PATCH", { language: "xx" })).body.error.code, "BAD_REQUEST");

  const chinese = await call("/api/works", "POST", { title: "旧作二" });
  const chineseSummary = (await call("/api/works")).body.works.find((work) => work.id === chinese.body.work.id);
  assert.equal(chineseSummary.stats.wordUnit, "characters");
  assert.equal(chineseSummary.focus, "shape", "no choice and no text reads as shape");
});

test("the chat assistant is told to answer in the story's language", () => {
  const { buildChatSystemPrompt } = require("../server");
  const english = buildChatSystemPrompt({ language: "en", title: "Ferry", premise: "A mapmaker.", storyBible: { logline: "Maps lie." } });
  assert.match(english, /Always reply in English/);
  assert.match(english, /Core concept: Maps lie./);
  assert.doesNotMatch(english, /[一-鿿]/, "no Chinese instructions in an English story's prompt");
  const chinese = buildChatSystemPrompt({ title: "旧作" });
  assert.match(chinese, /中文小说创作伙伴/);
  for (const name of Object.values(brand.name)) assert.ok(!english.includes(name) && !chinese.includes(name), "prompts do not hard-code the brand name");
});

test("conversations say when they are still unnamed, and drafts carry field keys", async () => {
  const created = await call("/api/works", "POST", { title: "Talk", language: "en", focus: "shape" });
  const id = created.body.work.id;
  const loaded = await call(`/api/works/${id}/chats`);
  assert.equal(loaded.status, 200);
  assert.equal(loaded.body.chats.length, 1);
  assert.equal(loaded.body.chats[0].untitled, true);
  const chatId = loaded.body.chats[0].id;

  const renamed = await call(`/api/works/${id}/chats/${chatId}`, "PATCH", { title: "Villains" });
  assert.equal(renamed.body.chat.untitled, false);
  assert.equal(renamed.body.chat.title, "Villains");
  const cleared = await call(`/api/works/${id}/chats/${chatId}`, "PATCH", { title: "" });
  assert.equal(cleared.body.chat.untitled, true);

  const draft = await call(`/api/works/${id}/chats/${chatId}/proposals`, "POST", { type: "characters" });
  assert.equal(draft.status, 201);
  assert.deepEqual(draft.body.proposal.sections.map((section) => section.key).sort(), ["characters", "relationships"]);
  const unknown = await call(`/api/works/${id}/chats/${chatId}/proposals`, "POST", { type: "spaceships" });
  assert.equal(unknown.body.error.code, "ARTIFACT_TYPE_UNSUPPORTED");
});

test("writing prompts ask for English prose in English stories", () => {
  const { buildAiPrompt } = require("../server");
  assert.match(buildAiPrompt({ work: { language: "en" }, chapter: {}, mode: "continue" }), /^Output language: English/);
  assert.doesNotMatch(buildAiPrompt({ work: {}, chapter: {}, mode: "continue" }), /Output language/);
});

test("new chapters are named in the story's language", async () => {
  const english = (await call("/api/works", "POST", { title: "Names", language: "en" })).body.work;
  const added = await call(`/api/works/${english.id}/chapters`, "POST", {});
  assert.equal(added.body.chapter.title, "Chapter 2");
  const chinese = (await call("/api/works", "POST", { title: "命名" })).body.work;
  assert.equal((await call(`/api/works/${chinese.id}/chapters`, "POST", {})).body.chapter.title, "第2章");
});
