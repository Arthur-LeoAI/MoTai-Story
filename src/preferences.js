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
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null
  };
}

function validatePatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw appError("BAD_REQUEST");
  const next = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === "uiLocale" && UI_LOCALES.includes(value)) next.uiLocale = value;
    else if (key === "theme" && THEMES.includes(value)) next.theme = value;
    else throw appError("BAD_REQUEST");
  }
  return next;
}

function createPreferenceRepository(store, { now = () => new Date().toISOString() } = {}) {
  async function get(userId) {
    if (!userId) throw appError("AUTH_REQUIRED");
    const db = await store.read();
    return normalizePreferences(db.userPreferences?.[userId]);
  }

  async function update(userId, patch) {
    if (!userId) throw appError("AUTH_REQUIRED");
    const changes = validatePatch(patch);
    return store.transact((db) => {
      db.userPreferences ||= {};
      const next = { ...normalizePreferences(db.userPreferences[userId]), ...changes, ownerId: userId, updatedAt: now() };
      db.userPreferences[userId] = next;
      return normalizePreferences(next);
    });
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
