import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "../../shared/locales/en.json";
import zhCN from "../../shared/locales/zh-CN.json";
import { brandName, storageKey } from "./brand";

// Interface language only. The language a story is written in is a separate
// per-work setting (work.language) and never follows this value.
export const UI_LOCALES = ["en", "zh-CN"] as const;
export type UiLocale = (typeof UI_LOCALES)[number];
export const SOURCE_LOCALE: UiLocale = "en";

const LOCALE_KEY = storageKey("ui-locale");

export function isUiLocale(value: unknown): value is UiLocale {
  return typeof value === "string" && (UI_LOCALES as readonly string[]).includes(value);
}

function readStoredLocale(): UiLocale | null {
  try {
    const value = localStorage.getItem(LOCALE_KEY);
    return isUiLocale(value) ? value : null;
  } catch {
    return null;
  }
}

export function rememberLocale(locale: UiLocale): void {
  try {
    localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    // Storage can be unavailable (private mode); the server copy still applies.
  }
}

export function detectInitialLocale(): UiLocale {
  const stored = readStoredLocale();
  if (stored) return stored;
  const preferred = typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language];
  return preferred.some((tag) => tag?.toLowerCase().startsWith("zh")) ? "zh-CN" : SOURCE_LOCALE;
}

// The brand name is injected from shared/brand.json (single source) and used
// in strings by nesting: "$t(brand.name)".
function withBrand<T extends object>(resources: T, locale: UiLocale) {
  return { ...resources, brand: { name: brandName(locale) } };
}

export const missingKeys = new Set<string>();

export function initI18n(locale: UiLocale) {
  return i18n.use(initReactI18next).init({
    lng: locale,
    fallbackLng: SOURCE_LOCALE,
    supportedLngs: [...UI_LOCALES],
    resources: {
      en: { translation: withBrand(en, "en") },
      "zh-CN": { translation: withBrand(zhCN, "zh-CN") }
    },
    interpolation: { escapeValue: false },
    returnNull: false,
    saveMissing: true,
    missingKeyHandler: (lngs, _ns, key) => {
      missingKeys.add(key);
      console.error(`Missing translation "${key}" for ${lngs.join(", ")}`);
    }
  });
}

export default i18n;
