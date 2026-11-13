import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { api, errorText } from "./api";
import { isUiLocale, rememberLocale, type UiLocale } from "./i18n";
import { applyTheme, isTheme, type Theme } from "./theme";

interface PreferencesValue {
  locale: UiLocale;
  theme: Theme;
  setLocale: (locale: UiLocale) => void;
  toggleTheme: () => void;
  /** undefined while loading; null until the first-run welcome is done. */
  welcomedAt: string | null | undefined;
  markWelcomed: () => void;
  /** A translated message when preferences could not be loaded or saved. */
  notice: string;
}

const PreferencesContext = createContext<PreferencesValue | null>(null);

export function PreferencesProvider({ initialTheme, children }: { initialTheme: Theme; children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [notice, setNotice] = useState("");
  const [welcomedAt, setWelcomedAt] = useState<string | null | undefined>(undefined);
  const locale: UiLocale = isUiLocale(i18n.resolvedLanguage) ? i18n.resolvedLanguage : "en";

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => applyTheme(theme), [theme]);

  // Preferences saved on the server win over this device's copy once they arrive.
  useEffect(() => {
    let active = true;
    api.session()
      .then(({ preferences }) => {
        if (!active) return;
        setWelcomedAt(preferences.welcomedAt ?? null);
        if (!preferences.updatedAt) return;
        if (isUiLocale(preferences.uiLocale) && preferences.uiLocale !== i18n.resolvedLanguage) {
          rememberLocale(preferences.uiLocale);
          void i18n.changeLanguage(preferences.uiLocale);
        }
        if (isTheme(preferences.theme)) setTheme(preferences.theme);
      })
      .catch((error) => active && setNotice(errorText(t, error)));
    return () => {
      active = false;
    };
    // Load once on start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = useCallback((patch: { uiLocale?: UiLocale; theme?: Theme; welcomed?: true }) => {
    api.updatePreferences(patch).then(() => setNotice("")).catch((error) => setNotice(errorText(t, error)));
  }, [t]);

  const value = useMemo<PreferencesValue>(() => ({
    locale,
    theme,
    notice,
    welcomedAt,
    markWelcomed: () => {
      setWelcomedAt(new Date().toISOString());
      save({ welcomed: true });
    },
    setLocale: (next) => {
      rememberLocale(next);
      void i18n.changeLanguage(next);
      save({ uiLocale: next });
    },
    toggleTheme: () => {
      const next: Theme = theme === "paper" ? "candle" : "paper";
      setTheme(next);
      save({ theme: next });
    }
  }), [locale, theme, notice, welcomedAt, i18n, save]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesValue {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error("usePreferences must be used inside PreferencesProvider");
  return value;
}
