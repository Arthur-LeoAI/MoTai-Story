const test = require('node:test');
const assert = require('node:assert/strict');
const { parseManuscript, splitChapters, createDocx } = require('../src/manuscript-import');
const encoded = (text) => Buffer.from(text).toString('base64');

test('20 chapters retain all body paragraphs, order and titles', async () => {
  const source = Array.from({ length: 20 }, (_, i) => `第${i + 1}章 夜航\n  第${i + 1}次航行。\n下一段。`).join('\n');
  const result = await parseManuscript({ fileName: '夜航.txt', base64: encoded(source) });
  assert.equal(result.title, '夜航');
  assert.equal(result.chapters.length, 20);
  assert.equal(result.chapters.map((chapter) => `${chapter.title}\n${chapter.content}`).join('\n'), source);
  assert.equal(result.encoding, 'utf-8');
  assert.equal(splitChapters('第一章雾\n雾来了。\n第二章灯\n灯灭了。').length, 2);
});

test('plain input retains preface and whitespace rather than dropping it', () => {
  const result = splitChapters('作者前言\n\n第一章 灯\n正文\n\n');
  assert.equal(result.length, 2);
  assert.equal(result[0].content, '作者前言\n');
  assert.equal(result[1].content, '正文\n\n');
  assert.equal(splitChapters('只有正文')[0].content, '只有正文');
});

test('GB18030 auto decoding and explicit wrong encoding error', async () => {
  const base64 = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]).toString('base64');
  const result = await parseManuscript({ fileName: '稿件.txt', base64 });
  assert.equal(result.chapters[0].content, '中文');
  assert.equal(result.encoding, 'gb18030');
  await assert.rejects(parseManuscript({ fileName: '稿件.txt', base64, encoding: 'utf-8' }), /编码/);
});

test('Markdown formatting is data and never interprets HTML or links', async () => {
  const result = await parseManuscript({ fileName: '稿件.md', base64: encoded('# 初见\n**加粗**与*斜体*\n<script>alert(1)</script>') });
  assert.equal(result.chapters[0].title, '初见');
  assert.ok(result.chapters[0].richContent.ops.some((op) => op.insert === '加粗' && op.attributes.bold));
  assert.ok(result.chapters[0].richContent.ops.some((op) => op.insert === '斜体' && op.attributes.italic));
  assert.ok(result.chapters[0].richContent.ops.some((op) => op.insert.includes('<script>')));
});

test('reject unsupported, invalid, empty, excessive or binary files', async () => {
  await assert.rejects(parseManuscript({ fileName: 'old.doc', base64: encoded('text') }), /DOC/);
  await assert.rejects(parseManuscript({ fileName: 'bad.txt', base64: '!!!' }), /编码/);
  await assert.rejects(parseManuscript({ fileName: 'empty.txt', base64: '' }), /为空/);
  await assert.rejects(parseManuscript({ fileName: 'large.txt', base64: encoded('字'.repeat(1_000_001)) }), /100 万/);
  await assert.rejects(parseManuscript({ fileName: 'binary.txt', base64: encoded('a\0b') }), /文本/);
  await assert.rejects(parseManuscript({ fileName: 'encrypted.docx', base64: encoded('not a zip') }), /DOCX/);
});

test('DOCX round trip preserves chapter names, Unicode, paragraphs and inline formatting', async () => {
  const work = { chapters: [
    { title: '灯塔', richContent: { ops: [{ insert: '雾<&', attributes: { bold: true } }, { insert: '航行', attributes: { italic: true, underline: true } }, { insert: '\n第二段😀\n' }] } },
    { title: '第二章 日出', content: '天亮了。\n' },
    { title: '已删除', content: '不应导出', deletedAt: '2026-01-01' }
  ] };
  const buffer = await createDocx(work);
  const result = await parseManuscript({ fileName: '灯塔.docx', base64: buffer.toString('base64') });
  assert.equal(result.chapters.length, 2);
  assert.equal(result.chapters[0].title, '灯塔');
  assert.equal(result.chapters[0].content, '雾<&航行\n第二段😀\n');
  assert.deepEqual(result.chapters[0].richContent.ops[0], { insert: '雾<&', attributes: { bold: true } });
  assert.deepEqual(result.chapters[0].richContent.ops[1], { insert: '航行', attributes: { italic: true, underline: true } });
  assert.equal(result.chapters[1].content, '天亮了。\n');
});

test('DOCX CRC corruption, encryption and excessive extracted size are rejected', async () => {
  const original = await createDocx({ chapters: [{ title: '一', content: '正文' }] });
  const corrupt = Buffer.from(original);
  corrupt[100] ^= 1;
  await assert.rejects(parseManuscript({ fileName: 'bad.docx', base64: corrupt.toString('base64') }), /校验/);
  const directory = original.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  const encrypted = Buffer.from(original);
  encrypted.writeUInt16LE(0x801, directory + 8);
  await assert.rejects(parseManuscript({ fileName: 'bad.docx', base64: encrypted.toString('base64') }), /加密/);
  const oversized = Buffer.from(original);
  oversized.writeUInt32LE(41 * 1024 * 1024, directory + 24);
  await assert.rejects(parseManuscript({ fileName: 'bad.docx', base64: oversized.toString('base64') }), /40MB/);
});
