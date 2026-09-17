// Explicit opt-in live smoke test. Uses a temporary database, never prints keys.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'motai-deepseek-live-'));
process.env.DATA_FILE = path.join(directory, 'db.json');
process.env.ENV_FILE = path.resolve(__dirname, '../.env.local');
delete process.env.MOTAI_TEST_AI;
const { createAppServer } = require('../server');
const server = createAppServer();
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(url, body) {
    const response = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    return result;
  }
  const { config } = await request('/api/ai/config');
  if (config.provider !== 'deepseek' || config.model !== 'deepseek-flash') throw new Error('Expected deepseek-flash');
  const { work } = await request('/api/works', { title: 'Flash 真实链路测试', premise: '林舟是一名不会游泳的普通灯塔管理员。故事发生在同一天的傍晚，救援船尚未到达，没有超自然力量。' });
  const chapter = work.chapters[0];
  const result = await request('/api/ai/write', { mode: 'continue', workId: work.id, chapterId: chapter.id, baseChapterUpdatedAt: chapter.updatedAt, instruction: '写150字左右，林舟在灯塔发现遇险船只，用无线电请求救援。不得让他下水，不得让救援船提前抵达。只写场景正文。' });
  if (!result.text?.trim() || !result.generation || !result.canAccept) throw new Error('Generation or continuity review did not pass');
  console.log(JSON.stringify({ model: result.generation.model, provider: result.generation.provider, canAccept: result.canAccept, text: result.text, conflicts: result.generation.conflicts, isolatedDatabase: directory }, null, 2));
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => server.close());
