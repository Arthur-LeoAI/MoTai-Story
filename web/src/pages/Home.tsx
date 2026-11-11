import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { api, errorText, type StoryFocus, type StoryLanguage, type WorkSummary } from "../api";
import { Notice, Ornament, PreferenceControls, RuleHeading, Wordmark, useDocumentTitle } from "../components/common";
import { formatCount, formatRelativeTime } from "../format";
import { UI_LOCALES } from "../i18n";
import { usePreferences } from "../preferences";
import { defaultSection, workPath } from "../sections";

function PathCard({ focus, selected, onSelect }: { focus: StoryFocus; selected: boolean; onSelect: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className={selected ? "card path-card selected" : "card path-card"}
      aria-pressed={selected}
      data-testid={`path-${focus}`}
      onClick={onSelect}
    >
      <span className="caps accent">{t(`home.${focus}.label`)}</span>
      <span className="display path-title">{t(`home.${focus}.title`)}</span>
      <span className="muted">{t(`home.${focus}.body`)}</span>
      <span className="path-opens">{t(`home.${focus}.opens`)}</span>
    </button>
  );
}

function WorkCard({ work }: { work: WorkSummary }) {
  const { t } = useTranslation();
  const { locale } = usePreferences();
  const { chapterCount, wordCount, wordUnit } = work.stats;
  const length = wordCount > 0
    ? t(`home.length.${wordUnit}`, { count: wordCount, formatted: formatCount(wordCount, locale) })
    : t("home.noText");
  const section = defaultSection(work.focus);
  const continueLabel = work.focus === "write" && work.lastEditedChapter
    ? t("home.continueChapter", { number: work.lastEditedChapter.number })
    : t("home.continueShaping");
  const status = t(`home.status.${work.focus}`);

  return (
    <article className="card work-card" data-testid="work-card" data-work-id={work.id} data-focus={work.focus}>
      <div className="cover" aria-hidden="true">
        <div className="cover-inner">
          <span className="cover-title" lang={work.language}>{work.title}</span>
          <span className="cover-rule" />
        </div>
      </div>
      <div className="work-body">
        <div className="caps" data-testid="work-status">{work.genre ? `${work.genre} · ${status}` : status}</div>
        <h3 className="display work-title" lang={work.language} data-testid="work-title">{work.title}</h3>
        <div className="muted" data-testid="work-stats">{t("home.chapters", { count: chapterCount })} · {length}</div>
        <div className="muted work-edited">{t("home.edited", { when: formatRelativeTime(work.updatedAt, locale) })}</div>
        <Link className="work-continue" to={workPath(work.id, section)} data-testid="work-continue">{continueLabel}</Link>
      </div>
    </article>
  );
}

export default function Home() {
  const { t } = useTranslation();
  const { locale } = usePreferences();
  const navigate = useNavigate();
  useDocumentTitle();

  const [premise, setPremise] = useState("");
  const [focus, setFocus] = useState<StoryFocus>("shape");
  // A new story is written in the interface language unless the writer says otherwise.
  const [storyLanguage, setStoryLanguage] = useState<StoryLanguage | null>(null);
  const [creating, setCreating] = useState(false);
  const [works, setWorks] = useState<WorkSummary[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api.listWorks()
      .then((result) => active && setWorks(result.works))
      .catch((cause) => {
        if (!active) return;
        setWorks([]);
        setError(errorText(t, cause));
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function begin(event: FormEvent) {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    setError("");
    try {
      const { work } = await api.createWork({ premise: premise.trim(), language: storyLanguage ?? locale, focus });
      navigate(workPath(work.id, defaultSection(focus)));
    } catch (cause) {
      setError(errorText(t, cause));
      setCreating(false);
    }
  }

  return (
    <div className="shell" data-testid="app-shell">
      <a className="skip-link" href="#main">{t("app.skipToContent")}</a>
      <header className="shell-header">
        <Wordmark />
        <PreferenceControls />
      </header>

      <main id="main" className="shell-main">
        <form className="home-new" onSubmit={begin} data-testid="new-story-form">
          <section className="hero" data-testid="hero">
            <div className="caps">{t("home.eyebrow")}</div>
            <h1 className="display hero-title" data-testid="hero-title">{t("home.heading")}</h1>
            <Ornament />
            <p className="hero-tagline">{t("home.tagline")}</p>
            <label htmlFor="premise" className="caps premise-label">{t("home.premiseLabel")}</label>
            <input
              id="premise"
              className="field premise-field"
              type="text"
              maxLength={500}
              value={premise}
              placeholder={t("home.premisePlaceholder")}
              onChange={(event) => setPremise(event.target.value)}
              data-testid="premise-input"
            />
            <label className="story-language">
              <span className="caps">{t("home.storyLanguage")}</span>
              <select
                className="field"
                value={storyLanguage ?? locale}
                onChange={(event) => setStoryLanguage(event.target.value as StoryLanguage)}
                data-testid="story-language-select"
              >
                {UI_LOCALES.map((code) => (
                  <option key={code} value={code} lang={code}>{t(`language.names.${code}`)}</option>
                ))}
              </select>
            </label>
          </section>

          <section className="home-section" aria-label={t("home.beginHeading")}>
            <RuleHeading>{t("home.beginHeading")}</RuleHeading>
            <div className="card-grid">
              <PathCard focus="shape" selected={focus === "shape"} onSelect={() => setFocus("shape")} />
              <PathCard focus="write" selected={focus === "write"} onSelect={() => setFocus("write")} />
            </div>
            <div className="begin-row">
              <button type="submit" className="btn primary begin-button" disabled={creating} data-testid="begin-button">
                {creating ? t("home.beginning") : t("home.begin")}
              </button>
              <span className="muted begin-hint">{t("home.changeLater")}</span>
            </div>
            {error ? <p className="notice" role="alert" data-testid="home-error">{error}</p> : null}
          </section>
        </form>

        <section className="home-section" aria-label={t("home.libraryHeading")} data-testid="library">
          <RuleHeading>{t("home.libraryHeading")}</RuleHeading>
          {works === null ? (
            <p className="muted library-empty" data-testid="library-loading">{t("app.loading")}</p>
          ) : works.length === 0 ? (
            <p className="muted library-empty" data-testid="library-empty">{t("home.emptyLibrary")}</p>
          ) : (
            <div className="card-grid">
              {works.map((work) => <WorkCard key={work.id} work={work} />)}
            </div>
          )}
        </section>

        <Notice />
      </main>
    </div>
  );
}
