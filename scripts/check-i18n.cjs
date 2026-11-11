// Checks the translation files:
//  1. every locale has exactly the same keys as the English source,
//  2. placeholders ({{name}}) match the English source,
//  3. every server error code has a translation,
//  4. every t("…") key used in web/src exists.
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

for (const [locale, entries] of Object.entries(locales)) {
  if (locale === source) continue;
  for (const key of Object.keys(base)) {
    if (!(key in entries)) problems.push(`${locale}: missing key ${key}`);
    else if (placeholders(base[key]) !== placeholders(entries[key])) problems.push(`${locale}: placeholders differ for ${key}`);
    else if (!String(entries[key]).trim()) problems.push(`${locale}: empty value for ${key}`);
  }
  for (const key of Object.keys(entries)) if (!(key in base)) problems.push(`${locale}: extra key ${key} (not in ${source})`);
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
let usedKeys = 0;
for (const file of walk(webSrc)) {
  const text = fs.readFileSync(file, "utf8");
  for (const match of text.matchAll(/\bt\(\s*["'`]([\w.-]+)["'`]/g)) {
    usedKeys += 1;
    if (!(match[1] in base)) problems.push(`${path.relative(root, file)}: unknown translation key ${match[1]}`);
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`Translations complete: ${Object.keys(locales).join(", ")} · ${Object.keys(base).length} keys · ${Object.keys(ERROR_STATUS).length} error codes · ${usedKeys} keys used in web/src.`);
