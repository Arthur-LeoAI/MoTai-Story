import { storageKey } from "./brand";

// Two themes from the design: "paper" (light) and "candle" (dark).
export const THEMES = ["paper", "candle"] as const;
export type Theme = (typeof THEMES)[number];

const THEME_KEY = storageKey("theme");

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

export function detectInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (isTheme(stored)) return stored;
  } catch {
    // ignore unavailable storage
  }
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches ? "candle" : "paper";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === "candle" ? "dark" : "light";
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // ignore unavailable storage
  }
}
