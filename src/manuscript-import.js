const { inflateRawSync } = require('node:zlib');
const path = require('node:path');
const { appError } = require('./errors');

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_TEXT = 1_000_000;
const MAX_EXPANDED = 40 * 1024 * 1024;
function invalid(code) { return appError(code); }
function plainDelta(text) { return { ops: [{ insert: text.endsWith('\n') ? text : `${text}\n` }] }; }
function heading(line) {
  const value = line.trim();
  if (/^#{1,3}\s+\S/.test(value)) return value.replace(/^#{1,3}\s+/, '');
  if (/^第[零〇一二三四五六七八九十百千万两\d]+[章节回卷部集]/u.test(value) && value.length <= 100) return value;
  if (/^(序章|楔子|尾声|后记|前言)(?:\s|[：:]|$)/u.test(value) && value.length <= 100) return value;
  // English headings: "Chapter 1", "CHAPTER IV", "Chapter One: The Ferry", "Part Two", "Prologue".
  if (/^(chapter|part|book)\s+([0-9]+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/i.test(value) && value.length <= 100) return value;
  if (/^(prologue|epilogue|interlude|afterword|foreword)\b/i.test(value) && value.length <= 100) return value;
  return '';
}

// The name given to text before the first heading follows the story language.
const firstChapterTitle = (language) => (language === 'en' ? 'Chapter 1' : '第一章');

function splitChapters(text, language) {
  text = String(text).replace(/\r\n?/g, '\n');
  if (text.length > MAX_TEXT) throw invalid("IMPORT_TEXT_TOO_LARGE");
  const chapters = [];
  let title = firstChapterTitle(language);
  let lines = [];
  let hasHeading = false;
  const flush = () => { const content = lines.join('\n'); chapters.push({ title, content, richContent: plainDelta(content) }); };
  for (const line of text.split('\n')) {
    const nextTitle = heading(line);
    if (nextTitle) {
      if (hasHeading || lines.some((value) => value.length)) flush();
      title = nextTitle;
      lines = [];
      hasHeading = true;
    } else lines.push(line);
  }
  flush();
  return chapters;
}

function markdownDelta(text) {
  const ops = [];
  for (const line of text.split('\n')) {
    const matcher = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_|`([^`]+)`)/g;
    let last = 0;
    for (const match of line.matchAll(matcher)) {
      if (match.index > last) ops.push({ insert: line.slice(last, match.index) });
      ops.push({ insert: match[2] || match[3] || match[4] || match[5] || match[6], attributes: match[2] || match[3] ? { bold: true } : match[6] ? { code: true } : { italic: true } });
      last = match.index + match[0].length;
    }
    if (last < line.length) ops.push({ insert: line.slice(last) });
    ops.push({ insert: '\n' });
  }
  return { ops };
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(buffer) { let crc = 0xffffffff; for (const byte of buffer) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }

function readZip(buffer) {
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) { end = i; break; }
  }
  if (end < 0) throw invalid("DOCX_INVALID");
  const count = buffer.readUInt16LE(end + 10);
  const start = buffer.readUInt32LE(end + 16);
  const size = buffer.readUInt32LE(end + 12);
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || buffer.readUInt16LE(end + 8) !== count || count > 2000 || start + size > end) throw invalid("DOCX_ARCHIVE_UNSUPPORTED");
  let cursor = start;
  let expanded = 0;
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== 0x02014b50) throw invalid("DOCX_CORRUPTED");
    const flags = buffer.readUInt16LE(cursor + 8), method = buffer.readUInt16LE(cursor + 10);
    const compressed = buffer.readUInt32LE(cursor + 20), uncompressed = buffer.readUInt32LE(cursor + 24);
    const nameLen = buffer.readUInt16LE(cursor + 28), extraLen = buffer.readUInt16LE(cursor + 30), commentLen = buffer.readUInt16LE(cursor + 32);
    const offset = buffer.readUInt32LE(cursor + 42);
    expanded += uncompressed;
    if (expanded > MAX_EXPANDED || flags & 1 || ![0, 8].includes(method) || buffer.readUInt16LE(cursor + 34)) throw invalid("DOCX_ENCRYPTED_OR_TOO_LARGE");
    if (cursor + 46 + nameLen + extraLen + commentLen > start + size) throw invalid("DOCX_CORRUPTED");
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLen).toString('utf8');
    if (files.has(name) || name.includes('..') || name.startsWith('/') || name.includes('\\')) throw invalid("DOCX_CORRUPTED");
    if (offset + 30 > start || buffer.readUInt32LE(offset) !== 0x04034b50) throw invalid("DOCX_CORRUPTED");
    const localNameLen = buffer.readUInt16LE(offset + 26), localExtraLen = buffer.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + localNameLen + localExtraLen;
    if (dataStart + compressed > start || buffer.readUInt16LE(offset + 6) !== flags || buffer.readUInt16LE(offset + 8) !== method || buffer.subarray(offset + 30, offset + 30 + localNameLen).toString('utf8') !== name) throw invalid("DOCX_CORRUPTED");
    let data;
    try { data = method === 0 ? buffer.subarray(dataStart, dataStart + compressed) : inflateRawSync(buffer.subarray(dataStart, dataStart + compressed), { maxOutputLength: Math.max(1, Math.min(MAX_EXPANDED, uncompressed)) }); }
    catch { throw invalid("DOCX_ENCRYPTED_OR_TOO_LARGE"); }
    if (data.length !== uncompressed || crc32(data) !== buffer.readUInt32LE(cursor + 16)) throw invalid("DOCX_CORRUPTED");
    files.set(name, data);
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  if (cursor !== start + size) throw invalid("DOCX_CORRUPTED");
  return files;
}

function decodeXml(text) {
  return text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (match, entity) => {
    const known = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (known[entity]) return known[entity];
    const code = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '\ufffd';
  });
}
function docxChapters(files, language) {
  const raw = files.get('word/document.xml');
  if (!raw || !files.has('[Content_Types].xml')) throw invalid("DOCX_NO_BODY");
  const xml = raw.toString('utf8');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw invalid("DOCX_EXTERNAL_ENTITY");
  const chapters = [];
  let chapter = { title: firstChapterTitle(language), content: '', richContent: { ops: [] } };
  let explicit = false;
  let chars = 0;
  for (const paragraph of xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)) {
    const ops = [];
    for (const run of paragraph[1].matchAll(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g)) {
      const attributes = {};
      for (const [tag, property] of [['b', 'bold'], ['i', 'italic'], ['u', 'underline']]) {
        const setting = run[1].match(new RegExp(`<w:${tag}\\b([^>]*)>`));
        if (setting && !/w:val=["'](?:0|false|none)["']/.test(setting[1])) attributes[property] = true;
      }
      for (const item of run[1].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:(tab|br|cr)\b[^>]*\/?\s*>/g)) {
        const insert = item[2] ? item[2] === 'tab' ? '\t' : '\n' : decodeXml(item[1]);
        ops.push(Object.keys(attributes).length ? { insert, attributes } : { insert });
      }
    }
    const text = ops.map((op) => op.insert).join('');
    chars += text.length + 1;
    if (chars > MAX_TEXT) throw invalid("IMPORT_TEXT_TOO_LARGE");
    const title = heading(text) || (/<w:pStyle\b[^>]*w:val=["']Heading1["']/i.test(paragraph[1]) ? text.trim() : '');
    if (title) {
      if (explicit || chapter.content) chapters.push(chapter);
      chapter = { title, content: '', richContent: { ops: [] } };
      explicit = true;
    } else {
      chapter.content += `${text}\n`;
      chapter.richContent.ops.push(...ops, { insert: '\n' });
    }
  }
  chapters.push(chapter);
  for (const value of chapters) if (!value.richContent.ops.length) value.richContent = plainDelta('');
  return chapters;
}

async function parseManuscript({ fileName = '', base64 = '', encoding = 'auto', language = 'zh-CN' } = {}) {
  const extension = path.extname(String(fileName)).toLowerCase();
  if (!['.txt', '.md', '.markdown', '.docx'].includes(extension)) throw invalid("IMPORT_FILE_TYPE_UNSUPPORTED");
  if (typeof base64 !== 'string' || base64.length > Math.ceil(MAX_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw invalid("IMPORT_FILE_INVALID");
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length || buffer.length > MAX_BYTES) throw invalid("IMPORT_FILE_EMPTY_OR_TOO_LARGE");
  const title = path.basename(String(fileName), extension).slice(0, 200) || '导入作品';
  if (extension === '.docx') {
    const files = readZip(buffer);
    return { title, chapters: docxChapters(files, language), encoding: 'utf-8', warnings: ['DOCX 仅导入正文段落及加粗、斜体、下划线；图片、页眉页脚、批注和复杂样式不导入。'], warningCodes: ['DOCX_TEXT_ONLY'] };
  }
  if (!['auto', 'utf-8', 'utf8', 'gb18030'].includes(encoding)) throw invalid("IMPORT_ENCODING_UNSUPPORTED");
  let actualEncoding = encoding === 'auto' || encoding === 'utf8' ? 'utf-8' : encoding;
  let text;
  try { text = new TextDecoder(actualEncoding, { fatal: true }).decode(buffer); }
  catch {
    if (encoding !== 'auto') throw invalid("IMPORT_ENCODING_MISMATCH");
    actualEncoding = 'gb18030';
    try { text = new TextDecoder(actualEncoding, { fatal: true }).decode(buffer); } catch { throw invalid("IMPORT_ENCODING_UNKNOWN"); }
  }
  if (text.includes('\u0000')) throw invalid("IMPORT_NOT_TEXT");
  const chapters = splitChapters(text, language);
  if (extension !== '.txt') for (const chapter of chapters) chapter.richContent = markdownDelta(chapter.content);
  return { title, chapters, encoding: actualEncoding, warnings: actualEncoding === 'gb18030' ? ['已按 GB18030 解码，请在预览中确认文字。'] : [], warningCodes: actualEncoding === 'gb18030' ? ['DECODED_GB18030'] : [] };
}

function zipStore(entries) {
  const locals = [], central = [];
  let offset = 0;
  for (const [name, value] of entries) {
    const bytes = Buffer.from(value), filename = Buffer.from(name), crc = crc32(bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt32LE(crc, 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8); directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(bytes.length, 20); directory.writeUInt32LE(bytes.length, 24); directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42);
    locals.push(local, filename, bytes); central.push(directory, filename); offset += local.length + filename.length + bytes.length;
  }
  const centralBytes = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}
function xmlEscape(text) { return String(text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
async function createDocx(work) {
  const paragraphs = [];
  for (const chapter of work.chapters || []) {
    if (chapter.deletedAt) continue;
    paragraphs.push(`<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${xmlEscape(chapter.title || '未命名章节')}</w:t></w:r></w:p>`);
    let runs = [];
    const ops = chapter.richContent?.ops || plainDelta(chapter.content || '').ops;
    for (const op of ops) {
      if (typeof op.insert !== 'string') continue;
      const props = `${op.attributes?.bold ? '<w:b/>' : ''}${op.attributes?.italic ? '<w:i/>' : ''}${op.attributes?.underline ? '<w:u w:val="single"/>' : ''}`;
      const parts = op.insert.split('\n');
      for (let i = 0; i < parts.length; i++) {
        if (parts[i]) runs.push(`<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${xmlEscape(parts[i])}</w:t></w:r>`);
        if (i < parts.length - 1) { paragraphs.push(`<w:p>${runs.join('')}</w:p>`); runs = []; }
      }
    }
    if (runs.length) paragraphs.push(`<w:p>${runs.join('')}</w:p>`);
  }
  return zipStore([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['word/styles.xml', '<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style></w:styles>'],
    ['word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.join('')}<w:sectPr/></w:body></w:document>`]
  ]);
}

module.exports = { parseManuscript, splitChapters, createDocx };
