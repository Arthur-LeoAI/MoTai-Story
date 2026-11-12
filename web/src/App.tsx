import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, errorText } from "./api";
import { UI_LOCALES, isUiLocale, rememberLocale, type UiLocale } from "./i18n";
import { applyTheme, isTheme, type Theme } from "./theme";

interface AppProps {
  initialTheme: Theme;
}

function Ornament({ width = 180 }: { width?: number }) {
  const half = width / 2;
  return (
    <svg className="ornament" aria-hidden="true" width={width} height="12" viewBox={`0 0 ${width} 12`}>
      <path d={`M0 6H${half - 12}M${half + 12} 6H${width}`} fill="none" />
      <path d={`M${half} 0l6 6-6 6-6-6z`} stroke="none" />
    </svg>
  );
}

export default function App({ initialTheme }: AppProps) {
  const { t, i18n } = useTranslation();
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [notice, setNotice] = useState("");
  const locale = (isUiLocale(i18n.resolvedLanguage) ? i18n.resolvedLanguage : "en") as UiLocale;

  // Interface language drives <html lang> and the tab title.
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t("app.documentTitle");
  }, [locale, t]);

  useEffect(() => applyTheme(theme), [theme]);

  // Server preferences win over this device's copy once they arrive.
  useEffect(() => {
    let active = true;
    api.session()
      .then(({ preferences }) => {
        if (!active) return;
        if (isUiLocale(preferences.uiLocale) && preferences.updatedAt && preferences.uiLocale !== i18n.resolvedLanguage) {
          rememberLocale(preferences.uiLocale);
          void i18n.changeLanguage(preferences.uiLocale);
        }
        if (isTheme(preferences.theme) && preferences.updatedAt) setTheme(preferences.theme);
      })
      .catch((error) => active && setNotice(errorText(t, error)));
    return () => {
      active = false;
    };
    // Load once on start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function save(patch: { uiLocale?: UiLocale; theme?: Theme }) {
    api.updatePreferences(patch).then(() => setNotice("")).catch((error) => setNotice(errorText(t, error)));
  }

  function changeLocale(next: UiLocale) {
    rememberLocale(next);
    void i18n.changeLanguage(next);
    save({ uiLocale: next });
  }

  function toggleTheme() {
    const next: Theme = theme === "paper" ? "candle" : "paper";
    setTheme(next);
    save({ theme: next });
  }

  return (
    <div className="shell" data-testid="app-shell">
      <a className="skip-link" href="#main">{t("app.skipToContent")}</a>
      <header className="shell-header">
        <div className={locale === "zh-CN" ? "wordmark wordmark-cjk" : "wordmark fell-sc"} data-testid="brand-wordmark">
          {t("brand.name")}
        </div>
        <nav className="shell-tools" aria-label={t("app.headerNav")}>
          <label className="visually-hidden" htmlFor="ui-locale">{t("language.label")}</label>
          <select
            id="ui-locale"
            className="field"
            data-testid="locale-select"
            value={locale}
            onChange={(event) => isUiLocale(event.target.value) && changeLocale(event.target.value)}
          >
            {UI_LOCALES.map((code) => (
              <option key={code} value={code} lang={code}>{t(`language.names.${code}`)}</option>
            ))}
          </select>
          <button
            type="button"
            className="btn quiet"
            data-testid="theme-toggle"
            aria-pressed={theme === "candle"}
            aria-label={theme === "paper" ? t("theme.switchToCandle") : t("theme.switchToPaper")}
            onClick={toggleTheme}
          >
            {theme === "paper" ? t("theme.candle") : t("theme.paper")}
          </button>
        </nav>
      </header>

      <main id="main" className="shell-main">
        <section className="hero" data-testid="hero">
          <div className="caps">{t("app.eyebrow")}</div>
          <h1 className="display hero-title" data-testid="hero-title">{t("app.heading")}</h1>
          <Ornament />
          <p className="hero-tagline">{t("app.tagline")}</p>
        </section>

        <section className="card foundation-note" data-testid="foundation-note">
          <p>{t("app.foundationNote")}</p>
          <p className="muted">{t("language.storyLanguageNote")}</p>
          <a href="/" data-testid="legacy-link">{t("app.legacyLink")}</a>
        </section>

        {notice ? <p className="notice" role="status" data-testid="app-notice">{notice}</p> : null}
      </main>
    </div>
  );
}
