"use strict";
const { appError } = require("./errors");

// Per-user app preferences for the new frontend. All reads and writes go
// through the storage layer (`store.read` / `store.transact`), keyed by the
// owner's user id; this module never touches files itself.
const UI_LOCALES = Object.freeze(["en", "zh-CN"]);
const THEMES = Object.freeze(["paper", "candle"]);
const DEFAULT_PREFERENCES = Object.freeze({ uiLocale: "en", theme: "paper" });

function normalizePreferences(value = {}) {
  return {
    uiLocale: UI_LOCALES.includes(value.uiLocale) ? value.uiLocale : DEFAULT_PREFERENCES.uiLocale,
    theme: THEMES.includes(value.theme) ? value.theme : DEFAULT_PREFERENCES.theme,
    // When the user finished or skipped the first-run welcome; null until then.
    welcomedAt: typeof value.welcomedAt === "string" ? value.welcomedAt : null,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null
  };
}

function validatePatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw appError("BAD_REQUEST");
  const next = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === "uiLocale" && UI_LOCALES.includes(value)) next.uiLocale = value;
    else if (key === "theme" && THEMES.includes(value)) next.theme = value;
    else if (key === "welcomed" && value === true) next.welcomed = true;
    else throw appError("BAD_REQUEST");
  }
  return next;
}

function createPreferenceRepository(store, { now = () => new Date().toISOString() } = {}) {
  async function get(userId) {
    if (!userId) throw appError("AUTH_REQUIRED");
    return normalizePreferences((await store.readDocument("userPreferences", userId)) || {});
  }

  async function update(userId, patch) {
    if (!userId) throw appError("AUTH_REQUIRED");
    const changes = validatePatch(patch);
    const stored = await store.transactDocument("userPreferences", userId, (current) => {
      const { welcomed, ...rest } = changes;
      const previous = normalizePreferences(current || {});
      const next = { ...previous, ...rest, welcomedAt: welcomed ? previous.welcomedAt || now() : previous.welcomedAt, ownerId: userId, updatedAt: now() };
      return next;
    });
    return normalizePreferences(stored);
  }

  return { get, update };
}

module.exports = {
  DEFAULT_PREFERENCES,
  THEMES,
  UI_LOCALES,
  createPreferenceRepository,
  normalizePreferences
};
