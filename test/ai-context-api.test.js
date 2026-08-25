const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "motai-ai-mock-"));
process.env.DATA_FILE = path.join(directory, "db.json");
process.env.ENV_FILE = path.join(directory, ".env.local");
process.env.AI_PROVIDER = "local";

const { createAppServer } = require("../server");
const requests = [];
let responseCall = 0;
const detailedSetting = "天穹星港的每一条跃迁航线都由航标、导航 AI 和轨道议会共同维持；任何一次篡改都会在相邻殖民地留下可被追踪的时序回声。林舟必须从维修记录、货船黑匣子和师父留下的密钥中逐步还原真相，同时避免走私集团抢先夺走关键航标。".repeat(12);
const chapterPlan = Array.from({ length: 8 }, (_, index) => `第${index + 1}章｜星港航标${index + 1}｜剧情目标：推进航线危机｜成长点：掌握一项导航技能｜爽点：提前锁定关键坐标｜冲突：走私集团制造阻碍｜结尾钩子：未来信号出现新的异常`).join("\n");

function readJson(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, payload) {
  response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

const mockAi = http.createServer(async (request, response) => {
  const body = await readJson(request);
  requests.push({ url: request.url, body });

  if (request.url === "/v1/images/generations") {
    sendJson(response, {
      data: [{
        b64_json: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Jj2kAAAAASUVORK5CYII="
      }]
    });
    return;
  }

  responseCall += 1;
  const text = responseCall === 1
    ? JSON.stringify({
      logline: "维修学徒在星港拦截一段未来信号，必须阻止航线失控。",
      theme: "选择与代价",
      tone: "硬核科幻、紧张克制",
      genrePositioning: "太空科幻成长冒险",
      worldview: detailedSetting,
      rules: detailedSetting,
      era: "近未来星际殖民时代；航标网络是所有殖民地的生命线。",
      characters: `林舟：星港维修学徒｜目标：守住师父留下的航线｜秘密：未来信号与他有关｜成长弧：从技术员成为决策者\n苏弥：轨道议会调查员｜目标：查清航标事故｜秘密：曾参与密钥封存｜成长弧：从怀疑林舟到承担责任\n顾岚：货船领航员｜目标：救回失控货船的船员｜弱点：害怕再次失去搭档｜成长弧：学会信任他人\n程野：走私集团联络人｜目标：夺取航标密钥｜秘密：受更高层操控｜成长弧：从追捕者变成真相的缺口。${detailedSetting}`,
      relationships: "林舟 -> 苏弥：调查搭档｜互相防备｜密钥封存责任未明\n林舟 -> 顾岚：救援盟友｜共同登船｜货船事故可能牵连师父\n林舟 -> 程野：追查者/被追查者｜程野试图夺取密钥｜未来信号暴露程野的上游\n苏弥 -> 程野：审查官/线人｜旧案相识｜谁在篡改证据仍未揭开。",
      factions: "轨道议会与航线走私集团争夺航标控制权，货船联合会夹在双方之间。",
      locations: "天穹星港、失控的第七码头、外环跃迁带和废弃航标站。",
      conflict: `林舟必须在航线崩坏前找出篡改者。${detailedSetting}`,
      antagonistPressure: "走私集团持续制造事故掩盖真相，并以失踪乘客逼迫林舟交出密钥。",
      foreshadowing: "未来信号里反复出现不存在的航标编号，编号同时出现在师父的维修日志中。",
      continuityNotes: "林舟尚未离开星港；导航 AI 只能提供片段线索；走私集团还不知道密钥在林舟手中。",
      outline: `第一卷先救回失控货船，再查出航标阴谋，最终发现未来信号来自被困的自己。${detailedSetting}`,
      chapterPlan
    })
    : responseCall === 3
      ? "星港的回声"
      : "林舟抬头望向警报闪烁的穹顶，失控货船正从黑暗里撞来。";
  sendJson(response, { output: [{ content: [{ type: "output_text", text }] }] });
});

const appServer = createAppServer();
let baseUrl = "";
let mockBaseUrl = "";

test.before(async () => {
  await new Promise((resolve, reject) => {
    mockAi.once("error", reject);
    mockAi.listen(0, "127.0.0.1", resolve);
  });
  mockBaseUrl = `http://127.0.0.1:${mockAi.address().port}/v1`;
  await new Promise((resolve, reject) => {
    appServer.once("error", reject);
    appServer.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${appServer.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => appServer.close(resolve));
  await new Promise((resolve) => mockAi.close(resolve));
  await fsp.rm(directory, { recursive: true, force: true });
});

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers }
  });
  return { response, payload: await response.json() };
}

test("模拟 AI 请求携带设定库、章纲与连续性，并覆盖封面链路", async () => {
  const config = await request("/api/ai/config", {
    method: "POST",
    body: JSON.stringify({
      provider: "openai",
      apiKey: "test-key",
      baseUrl: mockBaseUrl,
      model: "mock-model",
      endpoint: "responses",
      imageApiKey: "image-key",
      imageBaseUrl: mockBaseUrl,
      imageModel: "mock-image",
      localFallback: false
    })
  });
  assert.equal(config.response.status, 200);

  const created = await request("/api/works", {
    method: "POST",
    body: JSON.stringify({
      title: "星港来信",
      author: "林墨",
      genre: "科幻",
      premise: "维修学徒在星港接到来自未来的求救信号。",
      boldness: 68
    })
  });
  const work = created.payload.work;

  const bible = await request(`/api/works/${work.id}/story-bible/generate`, { method: "POST" });
  assert.equal(bible.response.status, 200);
  assert.equal(bible.payload.fallback, false);

  const configuredWork = bible.payload.work;
  const chapter = configuredWork.chapters[0];
  const writing = await request("/api/ai/write", {
    method: "POST",
    body: JSON.stringify({ mode: "continue", work: configuredWork, chapter })
  });
  assert.equal(writing.response.status, 200);
  assert.match(writing.payload.text, /林舟/);

  const title = await request("/api/ai/write", {
    method: "POST",
    body: JSON.stringify({ mode: "title", work: configuredWork, chapter })
  });
  assert.equal(title.response.status, 200);
  assert.equal(title.payload.text, "星港的回声");

  const cover = await request(`/api/works/${work.id}/cover/generate`, {
    method: "POST",
    body: JSON.stringify({ prompt: "轨道星港中的原创维修学徒，竖版海报构图" })
  });
  assert.equal(cover.response.status, 200);
  assert.equal(cover.payload.fallback, false);
  const coverFile = await fetch(`${baseUrl}${cover.payload.cover}`);
  assert.match(coverFile.headers.get("content-type"), /image\/svg\+xml/);
  const coverSvg = await coverFile.text();
  assert.match(coverSvg, /星港来信/);
  assert.match(coverSvg, /作者 · 林墨/);

  const illustration = await request(`/api/works/${work.id}/chapters/${chapter.id}/images/generate`, {
    method: "POST",
    body: JSON.stringify({ caption: "失控货船接近星港", prompt: "警报闪烁的星港穹顶与失控货船" })
  });
  assert.equal(illustration.response.status, 201);
  assert.match(illustration.payload.markdown, /失控货船接近星港/);
  assert.match(illustration.payload.image, /^\/data\/covers\/illustration-/);

  const wallpaper = await request("/api/wallpapers/generate", {
    method: "POST",
    body: JSON.stringify({
      name: "星港来信 · 作品壁纸",
      theme: "midnight",
      workId: work.id,
      prompt: "星港舷窗外的跃迁光带，右侧有航标投影"
    })
  });
  assert.equal(wallpaper.response.status, 201);
  assert.equal(wallpaper.payload.wallpaper.workId, work.id);
  assert.match(wallpaper.payload.wallpaper.image, /^\/data\/wallpapers\//);

  const textPrompts = requests
    .filter((item) => item.url === "/v1/responses")
    .map((item) => JSON.stringify(item.body));
  assert.ok(textPrompts.some((prompt) => prompt.includes("世界观") && prompt.includes("当前应推进的章节规划") && prompt.includes("连续性提醒")));

  const imageRequests = requests.filter((item) => item.url === "/v1/images/generations");
  assert.equal(imageRequests.length, 3);
  assert.match(imageRequests[0].body.prompt, /星港来信/);
  assert.match(imageRequests[0].body.prompt, /世界观/);
  assert.match(imageRequests[0].body.prompt, /轨道星港/);
  assert.match(imageRequests[1].body.prompt, /当前章节/);
  assert.match(imageRequests[1].body.prompt, /当前应推进的章节规划/);
  assert.match(imageRequests[1].body.prompt, /连续性提醒/);
  assert.match(imageRequests[2].body.prompt, /星港来信/);
  assert.match(imageRequests[2].body.prompt, /核心冲突/);
  assert.match(imageRequests[2].body.prompt, /不要在壁纸中画出书名/);
});
