// Verifies WCAG 2.1 contrast for the colour tokens in web/src/styles/tokens.css,
// in both themes. Text pairs need 4.5:1 (AA); graphics (entity colours) 3:1.
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "..", "web", "src", "styles", "tokens.css"), "utf8");

function block(selector) {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`Theme block not found: ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const tokens = {};
  for (const match of css.slice(open + 1, close).matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) tokens[match[1]] = match[2];
  return tokens;
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT = 4.5;
const GRAPHIC = 3;
const backgrounds = ["color-bg", "color-surface", "color-surface-raised", "color-surface-sunk"];
const pairs = [
  ...["color-text", "color-text-muted", "color-text-subtle", "color-accent"].flatMap((fg) => backgrounds.map((bg) => [fg, bg, TEXT])),
  ["color-on-accent", "color-accent", TEXT],
  ["color-on-accent", "color-accent-hover", TEXT],
  ["color-text", "color-accent-soft", TEXT],
  ...["success", "warning", "danger", "info"].flatMap((name) => [
    [`color-${name}`, "color-bg", TEXT],
    [`color-${name}`, "color-surface", TEXT],
    ["color-text", `color-${name}-soft`, TEXT]
  ]),
  ...["character", "location", "faction", "event", "rule"].flatMap((name) => [
    [`color-entity-${name}`, "color-bg", GRAPHIC],
    [`color-entity-${name}`, "color-surface", GRAPHIC]
  ])
];

const paper = block(':root[data-theme="paper"]');
const themes = { paper, candle: { ...paper, ...block(':root[data-theme="candle"]') } };
const failures = [];
let checked = 0;
for (const [theme, tokens] of Object.entries(themes)) {
  for (const [fg, bg, min] of pairs) {
    if (!tokens[fg] || !tokens[bg]) { failures.push(`${theme}: missing --${!tokens[fg] ? fg : bg}`); continue; }
    const value = ratio(tokens[fg], tokens[bg]);
    checked += 1;
    if (value < min) failures.push(`${theme}: --${fg} on --${bg} is ${value.toFixed(2)}:1, needs ${min}:1`);
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`Token contrast OK: ${checked} pairs across ${Object.keys(themes).length} themes (WCAG 2.1 AA).`);
