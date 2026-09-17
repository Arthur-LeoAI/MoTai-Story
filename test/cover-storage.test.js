const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "motai-cover-"));
const dataFile = path.join(directory, "db.json");
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="18"><rect width="12" height="18" fill="#123456"/></svg>';

fs.writeFileSync(dataFile, JSON.stringify({
  works: [
    {
      id: "work_cover",
      title: "Cover Migration",
      genre: "悬疑",
      tags: ["都市", "推理"],
      premise: "一封迟到的信，让她重新走进十年前无人提及的雨夜。",
      cover: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
      chapters: []
    }
  ]
}), "utf8");

process.env.DATA_FILE = dataFile;
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

async function request(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  const payload = await response.json();
  return { response, payload };
}

async function requestJson(pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return { response, payload: await response.json() };
}

test("base64 covers are migrated to local files and served by path", async () => {
  const listed = await request("/api/works");
  assert.equal(listed.response.status, 200);
  assert.equal(listed.payload.works.length, 1);

  const cover = listed.payload.works[0].cover;
  assert.match(cover, /^\/data\/covers\/work_cover-\d+-[a-z0-9]+\.svg$/i);
  assert.equal(cover.startsWith("data:"), false);

  const storedDb = JSON.parse(await fsp.readFile(dataFile, "utf8"));
  assert.equal(storedDb.works[0].cover, cover);
  assert.equal(storedDb.works[0].cover.startsWith("data:"), false);

  const files = await fsp.readdir(path.join(directory, "covers"));
  assert.deepEqual(files, [path.basename(cover)]);

  const image = await fetch(`${baseUrl}${cover}`);
  assert.equal(image.status, 200);
  assert.match(image.headers.get("content-type"), /^image\/svg\+xml/);
  assert.equal(await image.text(), svg);

  const detail = await request("/api/works/work_cover");
  assert.equal(detail.payload.work.cover, cover);
});

test("a user supplied PNG cover is stored locally for its own work", async () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9J3uUAAAAASUVORK5CYII=", "base64");
  const uploaded = await requestJson("/api/works/work_cover/cover/upload", {
    image: `data:image/png;base64,${png.toString("base64")}`
  });

  assert.equal(uploaded.response.status, 200);
  assert.match(uploaded.payload.cover, /^\/data\/covers\/work_cover-\d+-[a-z0-9]+\.svg$/i);
  const image = await fetch(`${baseUrl}${uploaded.payload.cover}`);
  assert.equal(image.status, 200);
  assert.match(image.headers.get("content-type"), /^image\/svg\+xml/);
  const coverSvg = await image.text();
  assert.match(coverSvg, /Cover Migr/);
  assert.match(coverSvg, /ation/);
  assert.match(coverSvg, /悬疑 · 都市 · 推理/);
  assert.match(coverSvg, /故事导语/);
  assert.match(coverSvg, /一封迟到的信，让她重新走进十年前无/);
  assert.match(coverSvg, /人提及的雨夜/);
  assert.match(coverSvg, /作者 · 未署名/);

  assert.equal(uploaded.payload.work.coverHistory.length, 2);
  assert.equal(uploaded.payload.work.coverHistory[0].source, "upload");
  assert.equal(uploaded.payload.work.coverHistory[1].source, "legacy");

  const rebuilt = await requestJson("/api/works/work_cover/cover/rebuild", {});
  assert.equal(rebuilt.response.status, 200);
  assert.equal(rebuilt.payload.source, "layout");
  assert.equal(rebuilt.payload.work.coverHistory[0].source, "layout");
  const rebuiltImage = await fetch(`${baseUrl}${rebuilt.payload.cover}`);
  assert.equal(rebuiltImage.status, 200);
  assert.match(await rebuiltImage.text(), /故事导语/);

  const restored = await requestJson("/api/works/work_cover/cover/select", {
    historyId: uploaded.payload.work.coverHistory[1].id
  });
  assert.equal(restored.response.status, 200);
  assert.equal(restored.payload.cover, uploaded.payload.work.coverHistory[1].cover);
  assert.equal(restored.payload.work.coverHistory.length, 3);
});

test("a finished uploaded cover can opt out of every text overlay", async () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9J3uUAAAAASUVORK5CYII=", "base64");
  const updated = await fetch(`${baseUrl}/api/works/work_cover`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      coverStyle: { showTitle: false, showMetadata: false, showLogline: false, showAuthor: false }
    })
  });
  assert.equal(updated.status, 200);

  const uploaded = await requestJson("/api/works/work_cover/cover/upload", {
    image: `data:image/png;base64,${png.toString("base64")}`
  });
  assert.equal(uploaded.response.status, 200);
  assert.match(uploaded.payload.cover, /^\/data\/covers\/work_cover-\d+-[a-z0-9]+\.png$/i);
  const image = await fetch(`${baseUrl}${uploaded.payload.cover}`);
  assert.equal(image.status, 200);
  assert.match(image.headers.get("content-type"), /^image\/png/);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
});
