const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { version } = require("../package.json");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "motai-api-"));
process.env.DATA_FILE = path.join(directory, "db.json");
process.env.ENV_FILE = path.join(directory, ".env.local");
process.env.MOTAI_TEST_AI = "1";

const { createAppServer } = require("../server");
const server = createAppServer();
let baseUrl = "";

test.before(async () => {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fsp.rm(directory, { recursive: true, force: true });
});

async function request(pathname, options = {}) {
  options = await require("./versioned-request").versionedOptions(baseUrl, pathname, options);
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    }
  });
  const payload = await response.json();
  return { response, payload };
}

test("health endpoint and static homepage are available", async () => {
  const health = await request("/api");
  assert.equal(health.response.status, 200);
  assert.equal(health.payload.ok, true);
  assert.equal(health.payload.name, "墨台写作平台");
  assert.equal(health.payload.version, version);

  const homepage = await fetch(`${baseUrl}/`);
  assert.equal(homepage.status, 200);
  assert.match(homepage.headers.get("content-type"), /text\/html/);

});

test("UI preferences persist locally without storing writing content or API keys", async () => {
  const saved = await request("/api/ui-preferences", {
    method: "PATCH",
    body: JSON.stringify({
      theme: "midnight",
      exportFormat: "pdf",
      inspectorTab: "bible",
      toolbarPrefs: { ai: false, bible: true, unexpected: false },
      workspace: {
        workId: "work-recent",
        chapterId: "chapter-recent",
        mainView: "bible",
        previewMode: true
      },
      apiKey: "must-not-be-saved",
      chapterContent: "must-not-be-saved"
    })
  });

  assert.equal(saved.response.status, 200);
  assert.equal(saved.payload.preferences.theme, "midnight");
  assert.equal(saved.payload.preferences.exportFormat, "pdf");
  assert.equal(saved.payload.preferences.workspace.workId, "work-recent");
  assert.equal(saved.payload.preferences.toolbarPrefs.ai, false);
  assert.equal(Object.hasOwn(saved.payload.preferences, "apiKey"), false);
  assert.equal(Object.hasOwn(saved.payload.preferences, "chapterContent"), false);

  const restored = await request("/api/ui-preferences");
  assert.equal(restored.response.status, 200);
  assert.equal(restored.payload.exists, true);
  assert.deepEqual(restored.payload.preferences, saved.payload.preferences);

  const raw = await fsp.readFile(path.join(directory, "ui-preferences.json"), "utf8");
  assert.doesNotMatch(raw, /must-not-be-saved/);
});

test("custom wallpapers are stored locally and can be selected without embedding image data in preferences", async () => {
  const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL3HwAAAABJRU5ErkJggg==";
  const uploaded = await request("/api/wallpapers/upload", {
    method: "POST",
    body: JSON.stringify({ name: "测试书房", theme: "paper", image })
  });

  assert.equal(uploaded.response.status, 201);
  assert.equal(uploaded.payload.wallpaper.name, "测试书房");
  assert.match(uploaded.payload.wallpaper.image, /^\/data\/wallpapers\/wallpaper-.+\.png$/);

  const imageResponse = await fetch(`${baseUrl}${uploaded.payload.wallpaper.image}`);
  assert.equal(imageResponse.status, 200);
  assert.match(imageResponse.headers.get("content-type"), /image\/png/);

  const saved = await request("/api/ui-preferences", {
    method: "PATCH",
    body: JSON.stringify({
      wallpaper: {
        selectedId: uploaded.payload.wallpaper.id,
        opacity: 30,
        customWallpapers: [uploaded.payload.wallpaper],
        image
      }
    })
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.payload.preferences.wallpaper.selectedId, uploaded.payload.wallpaper.id);
  assert.equal(saved.payload.preferences.wallpaper.opacity, 30);
  assert.equal(saved.payload.preferences.wallpaper.customWallpapers.length, 1);
  assert.equal(Object.hasOwn(saved.payload.preferences.wallpaper, "image"), false);

  const raw = await fsp.readFile(path.join(directory, "ui-preferences.json"), "utf8");
  assert.doesNotMatch(raw, /iVBORw0KGgo/);
});

test("AI config only saves a model choice and ignores credential fields", async () => {
  const saved = await request("/api/ai/config", {
    method: "POST",
    body: JSON.stringify({
      provider: "deepseek",
      apiKey: "must-not-be-saved",
      model: "deepseek-chat",
      baseUrl: "https://attacker.invalid",
      imageApiKey: "must-not-be-saved-either"
    })
  });

  assert.equal(saved.response.status, 200);
  assert.equal(saved.payload.config.provider, "deepseek");
  assert.equal(saved.payload.config.model, "deepseek-chat");
  assert.equal(saved.payload.config.hasApiKey, false);
  assert.equal(saved.payload.config.apiKey, "");

  const rawEnv = await fsp.readFile(process.env.ENV_FILE, "utf8");
  assert.match(rawEnv, /AI_PROVIDER=deepseek/);
  assert.match(rawEnv, /DEEPSEEK_MODEL=deepseek-chat/);
  assert.doesNotMatch(rawEnv, /must-not-be-saved|attacker\.invalid/);
});

test("model settings switch providers without accepting API keys", async () => {
  const openai = await request("/api/ai/config", {
    method: "POST",
    body: JSON.stringify({ provider: "openai", model: "gpt-5.5", apiKey: "ignored-openai-key" })
  });

  assert.equal(openai.response.status, 200);
  assert.equal(openai.payload.config.provider, "openai");
  assert.equal(openai.payload.config.hasApiKey, false);
  assert.equal(openai.payload.config.baseUrl, "https://api.openai.com/v1");
  assert.equal(openai.payload.config.model, "gpt-5.5");
  assert.equal(openai.payload.config.endpoint, "responses");
  assert.equal(openai.payload.config.providers.some((provider) => provider.value === "custom"), false);

  const switched = await request("/api/ai/config", {
    method: "POST",
    body: JSON.stringify({ provider: "deepseek", model: "deepseek-chat" })
  });
  assert.equal(switched.payload.config.provider, "deepseek");
  const rawEnv = await fsp.readFile(process.env.ENV_FILE, "utf8");
  assert.doesNotMatch(rawEnv, /ignored-openai-key/);
});

test("AI model list exposes choices but never credentials", async () => {
  const listed = await request("/api/ai/models");
  assert.equal(listed.response.status, 200);
  assert.deepEqual(listed.payload.models.map((model) => `${model.provider}:${model.id}`), [
    "deepseek:deepseek-chat",
    "openai:gpt-5.5"
  ]);
  assert.equal(JSON.stringify(listed.payload).includes("apiKey"), false);
});

test("story bible and writing tools work with the isolated test model", async () => {
  const created = await request("/api/works", {
    method: "POST",
    body: JSON.stringify({
      title: "超神学院之我是葛小伦",
      genre: "同人",
      premise: "卢小鱼魂穿葛小伦，绑定系统后加入雄兵连，在卡尔与虚空压力下改写地球命运。",
      tags: ["系统", "雄兵连"],
      boldness: 60
    })
  });
  assert.equal(created.response.status, 201);

  const work = created.payload.work;
  const chapter = work.chapters[0];
  const bible = await request(`/api/works/${work.id}/story-bible/generate`, { method: "POST" });
  assert.equal(bible.response.status, 200);
  assert.equal(bible.payload.fallback, false);
  assert.match(bible.payload.storyBible.characters, /葛小伦/);
  assert.match(bible.payload.storyBible.chapterPlan, /剧情目标：/);
  assert.ok(bible.payload.quality);
  assert.equal(typeof bible.payload.quality.score, "number");

  const quality = await request(`/api/works/${work.id}/story-bible/check`, { method: "POST", body: "{}" });
  assert.equal(quality.response.status, 200);
  assert.equal(Array.isArray(quality.payload.quality.checks), true);

  const configuredWork = bible.payload.work;
  const writing = await request("/api/ai/write", {
    method: "POST",
    body: JSON.stringify({
      mode: "continue",
      work: configuredWork,
      chapter: configuredWork.chapters.find((item) => item.id === chapter.id)
    })
  });
  assert.equal(writing.response.status, 200);
  assert.equal(writing.payload.fallback, false);
  assert.match(writing.payload.text, /卢小鱼/);

  const outline = await request("/api/ai/write", {
    method: "POST",
    body: JSON.stringify({
      mode: "outline",
      work: configuredWork,
      chapter: configuredWork.chapters[0]
    })
  });
  assert.equal(outline.response.status, 200);
  assert.match(outline.payload.text, /雄兵连/);

  const title = await request("/api/ai/write", {
    method: "POST",
    body: JSON.stringify({
      mode: "title",
      work: configuredWork,
      chapter: configuredWork.chapters[0]
    })
  });
  assert.equal(title.response.status, 200);
  assert.equal(title.payload.text, "我叫葛小伦！！！");

  const removed = await request(`/api/works/${work.id}`, { method: "DELETE" });
  assert.equal(removed.response.status, 200);
});

test("仿生人星际题材的本地设定库提供可执行人物关系与十二章推进", async () => {
  const created = await request("/api/works", {
    method: "POST",
    body: JSON.stringify({
      title: "人造月光",
      genre: "原创",
      premise: "在仿生人是否拥有“人格”仍被整个文明争论的时代，一个赏金猎人劫走了即将被销毁的少女型仿生人，从此他们既追捕银河中的罪犯，也被整个银河追捕。",
      tags: ["星际", "仿生人", "赏金猎人"]
    })
  });
  assert.equal(created.response.status, 201);

  const generated = await request(`/api/works/${created.payload.work.id}/story-bible/generate`, { method: "POST", body: "{}" });
  assert.equal(generated.response.status, 200);
  assert.equal(generated.payload.fallback, false);
  assert.match(generated.payload.storyBible.characters, /赏金猎人/);
  assert.match(generated.payload.storyBible.characters, /仿生人/);
  assert.match(generated.payload.storyBible.relationships, /->/);
  assert.equal(generated.payload.storyBible.chapterPlan.split("\n").length, 12);
  assert.equal(generated.payload.quality.ok, true);
});

test("chapter planning, cover layout and automatic backup are stored locally", async () => {
  const created = await request("/api/works", {
    method: "POST",
    body: JSON.stringify({ title: "章节看板测试", premise: "主角在旧城寻找失散的姐姐。" })
  });
  assert.equal(created.response.status, 201);
  const { work } = created.payload;
  const chapter = work.chapters[0];

  const chapterPatch = await request(`/api/works/${work.id}/chapters/${chapter.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "editing", planning: { goal: "找到旧线索", scene: "旧城区", characters: "林澈、阿宁", conflict: "线索被抢走", hook: "陌生来电" } })
  });
  assert.equal(chapterPatch.response.status, 200);
  assert.equal(chapterPatch.payload.chapter.planning.goal, "找到旧线索");
  assert.equal(chapterPatch.payload.chapter.status, "editing");

  const layout = await request(`/api/works/${work.id}`, {
    method: "PATCH",
    body: JSON.stringify({ coverLogline: "她在旧城等他回来。", coverStyle: { palette: "rose", titleAlign: "center", showLogline: false } })
  });
  assert.equal(layout.response.status, 200);
  assert.equal(layout.payload.work.coverStyle.palette, "rose");
  assert.equal(layout.payload.work.coverStyle.titleAlign, "center");
  assert.equal(layout.payload.work.coverStyle.showLogline, false);

  await new Promise((resolve) => setTimeout(resolve, 120));
  const backupStatus = await request("/api/backup/status");
  assert.equal(backupStatus.response.status, 200);
  assert.equal(backupStatus.payload.automatic.retention, 7);
  assert.ok(backupStatus.payload.automatic.count >= 1);

  const removed = await request(`/api/works/${work.id}`, { method: "DELETE" });
  assert.equal(removed.response.status, 200);
});

test("story bible generation ignores stale settings from another work", async () => {
  const created = await request("/api/works", {
    method: "POST",
    body: JSON.stringify({
      title: "再一次，喜欢你",
      genre: "原创",
      premise: "她花了很多年接受他已经忘了自己，却在重逢后发现，他一直记得那场告别。两人要在错过与现实之间重新学会喜欢。",
      tags: ["都市", "日常", "纯爱"]
    })
  });
  assert.equal(created.response.status, 201);

  const work = created.payload.work;
  const staleBible = {
    overview: "超神学院系统流",
    worldview: "雄兵连与饕餮战争。",
    characters: "卢小鱼魂穿葛小伦。",
    conflict: "卡尔与虚空来袭。",
    outline: "加入雄兵连。",
    chapterPlan: "第1章｜雄兵连｜剧情目标：加入学院｜成长点：觉醒｜爽点：系统奖励｜冲突：饕餮来袭｜结尾钩子：卡尔现身"
  };

  const seeded = await request(`/api/works/${work.id}`, {
    method: "PATCH",
    body: JSON.stringify({ storyBible: staleBible })
  });
  assert.equal(seeded.response.status, 200);

  const regenerated = await request(`/api/works/${work.id}/story-bible/generate`, { method: "POST" });
  assert.equal(regenerated.response.status, 200);
  const combined = Object.values(regenerated.payload.storyBible).join("\n");
  assert.doesNotMatch(combined, /超神学院|雄兵连|葛小伦|卢小鱼|卡尔|虚空/);
  assert.match(combined, /再一次，喜欢你|重逢|错过|告别/);
  assert.doesNotMatch(regenerated.payload.storyBible.characters, /^(男主|女主|共同好友|旧事知情人|医生)[：:]/m);
  assert.match(regenerated.payload.storyBible.relationships, /->/);
  assert.equal(regenerated.payload.storyBible.chapterPlan.split("\n").length, 12);

  const removed = await request(`/api/works/${work.id}`, { method: "DELETE" });
  assert.equal(removed.response.status, 200);
});

test("work and chapter API supports a complete local lifecycle", async () => {
  const created = await request("/api/works", {
    method: "POST",
    body: JSON.stringify({
      title: "  星港来信  ",
      premise: "一名维修师收到来自未来的求救信号。",
      boldness: 65
    })
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.payload.work.title, "星港来信");
  assert.equal(created.payload.work.chapters.length, 1);

  const workId = created.payload.work.id;
  const firstChapterId = created.payload.work.chapters[0].id;
  const updated = await request(`/api/works/${workId}`, {
    method: "PATCH",
    body: JSON.stringify({ tags: ["科幻", "悬疑"], boldness: 80 })
  });
  assert.equal(updated.payload.work.boldness, 80);
  assert.deepEqual(updated.payload.work.tags, ["科幻", "悬疑"]);

  const chapter = await request(`/api/works/${workId}/chapters/${firstChapterId}`, {
    method: "PATCH",
    body: JSON.stringify({ content: "雨落在星港的金属穹顶上。" })
  });
  assert.match(chapter.payload.chapter.content, /星港/);

  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL3HwAAAABJRU5ErkJggg==";
  const illustration = await request(`/api/works/${workId}/chapters/${firstChapterId}/images/upload`, {
    method: "POST",
    body: JSON.stringify({
      caption: "星港雨幕",
      image: `data:image/png;base64,${png}`
    })
  });
  assert.equal(illustration.response.status, 201);
  assert.match(illustration.payload.markdown, /星港雨幕/);
  assert.match(illustration.payload.image, /^\/data\/covers\/illustration-/);
  const illustrationResponse = await fetch(`${baseUrl}${illustration.payload.image}`);
  assert.equal(illustrationResponse.status, 200);
  assert.match(illustrationResponse.headers.get("content-type"), /image\/png/);

  const chapterWithIllustration = await request(`/api/works/${workId}/chapters/${firstChapterId}`, {
    method: "PATCH",
    body: JSON.stringify({ content: `雨落在星港的金属穹顶上。\n\n${illustration.payload.markdown}` })
  });
  assert.match(chapterWithIllustration.payload.chapter.content, /illustration-/);

  const listed = await request("/api/works");
  const listedWork = listed.payload.works.find((item) => item.id === workId);
  assert.ok(listedWork);
  assert.equal(listedWork.stats.totalCharacters, 12);

  const markdownExport = await fetch(`${baseUrl}/api/works/${workId}/export?format=markdown`);
  assert.equal(markdownExport.status, 200);
  assert.match(markdownExport.headers.get("content-type"), /text\/markdown/);
  assert.match(await markdownExport.text(), /# 星港来信/);

  const textExport = await fetch(`${baseUrl}/api/works/${workId}/export?format=txt`);
  assert.equal(textExport.status, 200);
  assert.match(textExport.headers.get("content-type"), /text\/plain/);

  const htmlExport = await fetch(`${baseUrl}/api/works/${workId}/export?format=html`);
  assert.equal(htmlExport.status, 200);
  assert.match(htmlExport.headers.get("content-type"), /text\/html/);
  assert.match(await htmlExport.text(), /chapter-image/);

  const wordExport = await fetch(`${baseUrl}/api/works/${workId}/export?format=doc`);
  assert.equal(wordExport.status, 200);
  assert.match(wordExport.headers.get("content-type"), /application\/msword/);

  const pdfExport = await fetch(`${baseUrl}/api/works/${workId}/export?format=pdf`);
  assert.equal(pdfExport.status, 200);
  assert.match(pdfExport.headers.get("content-type"), /application\/pdf/);
  const pdfBytes = Buffer.from(await pdfExport.arrayBuffer());
  assert.equal(pdfBytes.subarray(0, 5).toString(), "%PDF-");

  const secondChapter = await request(`/api/works/${workId}/chapters`, {
    method: "POST",
    body: JSON.stringify({ title: "第二章" })
  });
  assert.equal(secondChapter.response.status, 201);
  const deleteFirst = await request(`/api/works/${workId}/chapters/${firstChapterId}`, { method: "DELETE" });
  assert.equal(deleteFirst.response.status, 200);
  assert.equal(deleteFirst.payload.work.chapters.length, 1);
  const deleteLast = await request(`/api/works/${workId}/chapters/${secondChapter.payload.chapter.id}`, { method: "DELETE" });
  assert.equal(deleteLast.response.status, 200);
  assert.equal(deleteLast.payload.work.chapters.length, 0);

  const removed = await request(`/api/works/${workId}`, { method: "DELETE" });
  assert.equal(removed.payload.ok, true);
  assert.equal((await request("/api/works")).payload.works.some((item) => item.id === workId), false);
});
