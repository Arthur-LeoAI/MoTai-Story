// Checks the translation files:
//  1. every locale has the same keys as the English source,
//  2. placeholders ({{name}}) match the English source,
//  3. every server error code has a translation,
//  4. every literal t("…") key used in web/src exists.
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const localeDir = path.join(root, "shared", "locales");
const source = "en";
const problems = [];

function flatten(value, prefix = "", out = {}) {
  for (const [key, child] of Object.entries(value)) {
    const id = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object") flatten(child, id, out);
    else out[id] = child;
  }
  return out;
}

const placeholders = (text) => [...String(text).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort().join(",");

const locales = Object.fromEntries(fs.readdirSync(localeDir)
  .filter((file) => file.endsWith(".json"))
  .map((file) => [path.basename(file, ".json"), flatten(JSON.parse(fs.readFileSync(path.join(localeDir, file), "utf8")))]));

const base = locales[source];
if (!base) throw new Error(`Missing source locale ${source}.json`);

// Plural forms differ per language (English: _one/_other, Chinese: _other),
// so keys are compared without the plural suffix.
const PLURAL = /_(zero|one|two|few|many|other)$/;
const stem = (key) => key.replace(PLURAL, "");
const stems = (entries) => new Set(Object.keys(entries).map(stem));
const baseStems = stems(base);
const sourceKeyFor = (wanted) => (wanted in base ? wanted : Object.keys(base).find((key) => stem(key) === wanted));

for (const [locale, entries] of Object.entries(locales)) {
  if (locale === source) continue;
  const localeStems = stems(entries);
  for (const wanted of baseStems) {
    if (!localeStems.has(wanted)) {
      problems.push(`${locale}: missing key ${wanted}`);
      continue;
    }
    const sourceKey = sourceKeyFor(wanted);
    for (const key of Object.keys(entries).filter((candidate) => stem(candidate) === wanted)) {
      if (placeholders(base[sourceKey]) !== placeholders(entries[key])) problems.push(`${locale}: placeholders differ for ${key}`);
      else if (!String(entries[key]).trim()) problems.push(`${locale}: empty value for ${key}`);
    }
  }
  for (const key of localeStems) if (!baseStems.has(key)) problems.push(`${locale}: extra key ${key} (not in ${source})`);
}

const { ERROR_STATUS } = require(path.join(root, "src", "errors.js"));
for (const code of Object.keys(ERROR_STATUS)) {
  for (const locale of Object.keys(locales)) {
    if (!(`errors.${code}` in locales[locale])) problems.push(`${locale}: no translation for error code ${code}`);
  }
}

const webSrc = path.join(root, "web", "src");
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : /\.(tsx?|jsx?)$/.test(entry.name) ? [full] : [];
  });
}
// Keys added at runtime from shared/brand.json (see web/src/i18n.ts).
const RUNTIME_KEYS = new Set(["brand.name"]);
let usedKeys = 0;
for (const file of walk(webSrc)) {
  const text = fs.readFileSync(file, "utf8");
  // Only literal keys; template keys such as `language.names.${code}` are skipped.
  for (const match of text.matchAll(/\bt\(\s*(["'`])([\w.-]+)\1/g)) {
    usedKeys += 1;
    if (!baseStems.has(match[2]) && !RUNTIME_KEYS.has(match[2])) problems.push(`${path.relative(root, file)}: unknown translation key ${match[2]}`);
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`Translations complete: ${Object.keys(locales).join(", ")} · ${baseStems.size} keys · ${Object.keys(ERROR_STATUS).length} error codes · ${usedKeys} keys used in web/src.`);
