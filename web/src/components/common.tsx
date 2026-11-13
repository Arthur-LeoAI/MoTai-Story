import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { UI_LOCALES, isUiLocale } from "../i18n";
import { usePreferences } from "../preferences";

/** The printer's ornament from the mockup: a rule broken by a small lozenge. */
export function Ornament({ width = 180 }: { width?: number }) {
  const half = width / 2;
  return (
    <svg className="ornament" aria-hidden="true" width={width} height="12" viewBox={`0 0 ${width} 12`}>
      <path d={`M0 6H${half - 12}M${half + 12} 6H${width}`} fill="none" />
      <path d={`M${half} 0l6 6-6 6-6-6z`} stroke="none" />
    </svg>
  );
}

/** A small-caps heading set between two rules. */
export function RuleHeading({ children }: { children: string }) {
  return (
    <div className="rule-heading">
      <hr className="rule" />
      <h2 className="caps">{children}</h2>
      <hr className="rule" />
    </div>
  );
}

export function Wordmark({ size = 28 }: { size?: number }) {
  const { t } = useTranslation();
  const { locale } = usePreferences();
  return (
    <Link
      to="/"
      className={locale === "zh-CN" ? "wordmark wordmark-cjk" : "wordmark fell-sc"}
      style={{ fontSize: size }}
      data-testid="brand-wordmark"
    >
      {t("brand.name")}
    </Link>
  );
}

/** Interface language and theme. Shown in every page's header or sidebar. */
export function PreferenceControls() {
  const { t } = useTranslation();
  const { locale, theme, setLocale, toggleTheme } = usePreferences();
  return (
    <nav className="preference-controls" aria-label={t("app.headerNav")}>
      <label className="visually-hidden" htmlFor="ui-locale">{t("language.label")}</label>
      <select
        id="ui-locale"
        className="field"
        data-testid="locale-select"
        value={locale}
        onChange={(event) => isUiLocale(event.target.value) && setLocale(event.target.value)}
      >
        {UI_LOCALES.map((code) => (
          <option key={code} value={code} lang={code}>{t(`language.names.${code}`)}</option>
        ))}
      </select>
      <Link className="btn quiet" to="/settings" data-testid="settings-link">{t("settings.title")}</Link>
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
  );
}

/** Sets the browser tab title; the brand name comes from the translations. */
export function useDocumentTitle(page?: string) {
  const { t } = useTranslation();
  const title = page ? t("app.documentTitleWithPage", { page }) : t("app.documentTitle");
  useEffect(() => {
    document.title = title;
  }, [title]);
}

export function Notice() {
  const { notice } = usePreferences();
  return notice ? <p className="notice" role="status" data-testid="app-notice">{notice}</p> : null;
}
