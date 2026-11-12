import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, useParams } from "react-router-dom";
import { api, errorText, type WorkSummary } from "../api";
import { Notice, Ornament, PreferenceControls, Wordmark, useDocumentTitle } from "../components/common";
import Ideate from "./Ideate";
import Write from "./Write";
import { isSection, numeral, orderedSections, workPath, type Section } from "../sections";

type Loaded = { state: "loading" } | { state: "ready"; work: WorkSummary } | { state: "missing"; message: string };

/** Pages not rebuilt yet say so plainly and point at the workspace that still has the feature. */
function SectionPlaceholder({ section }: { section: Section }) {
  const { t } = useTranslation();
  const name = t(`nav.${section}`);
  return (
    <section className="section-placeholder" data-testid="section-placeholder" data-section={section}>
      <div className="caps">{name}</div>
      <h1 className="display section-title">{t("section.comingTitle", { section: name })}</h1>
      <Ornament width={140} />
      <p className="muted">{t("section.comingBody")}</p>
      <a className="btn" href="/" data-testid="legacy-link">{t("app.legacyLink")}</a>
    </section>
  );
}

function NotFound({ message }: { message?: string }) {
  const { t } = useTranslation();
  useDocumentTitle(t("app.notFoundTitle"));
  return (
    <div className="shell" data-testid="not-found">
      <header className="shell-header">
        <Wordmark />
        <PreferenceControls />
      </header>
      <main id="main" className="shell-main">
        <section className="section-placeholder">
          <h1 className="display section-title">{t("app.notFoundTitle")}</h1>
          {message ? <p className="muted">{message}</p> : null}
          <Link className="btn" to="/" data-testid="back-home">{t("app.backHome")}</Link>
        </section>
      </main>
    </div>
  );
}

export { NotFound };

export default function WorkFrame() {
  const { t } = useTranslation();
  const { workId = "", section = "" } = useParams();
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });

  useEffect(() => {
    let active = true;
    setLoaded({ state: "loading" });
    api.listWorks()
      .then(({ works }) => {
        if (!active) return;
        const work = works.find((candidate) => candidate.id === workId);
        setLoaded(work ? { state: "ready", work } : { state: "missing", message: t("errors.WORK_NOT_FOUND") });
      })
      .catch((cause) => active && setLoaded({ state: "missing", message: errorText(t, cause) }));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workId]);

  const sectionName = isSection(section) ? t(`nav.${section}`) : undefined;
  const workTitle = loaded.state === "ready" ? loaded.work.title : undefined;
  useDocumentTitle(workTitle && sectionName ? `${sectionName} · ${workTitle}` : sectionName);

  if (!isSection(section)) return <NotFound />;
  if (loaded.state === "missing") return <NotFound message={loaded.message} />;

  const sections = loaded.state === "ready" ? orderedSections(loaded.work.focus) : orderedSections("shape");

  return (
    <div className="frame" data-testid="work-frame" data-focus={loaded.state === "ready" ? loaded.work.focus : undefined}>
      <a className="skip-link" href="#main">{t("app.skipToContent")}</a>
      <aside className="frame-side">
        <Wordmark size={26} />
        <div className="story-chip" data-testid="story-chip">
          <span className="caps">{t("nav.story")}</span>
          <span lang={loaded.state === "ready" ? loaded.work.language : undefined} data-testid="story-title">
            {loaded.state === "ready" ? loaded.work.title : t("app.loading")}
          </span>
        </div>
        <nav className="frame-nav" aria-label={t("nav.label")}>
          {sections.map((item, index) => (
            <NavLink
              key={item}
              to={workPath(workId, item)}
              className={({ isActive }) => (isActive ? "navitem on" : "navitem")}
              data-testid={`nav-${item}`}
            >
              <span className="num" aria-hidden="true">{numeral(index)}</span>
              {t(`nav.${item}`)}
            </NavLink>
          ))}
        </nav>
        <div className="frame-side-foot">
          <PreferenceControls />
        </div>
      </aside>
      {section === "write" ? (
        <main id="main" className="frame-main frame-main-wide">
          {loaded.state === "ready" ? <Write key={loaded.work.id} summary={loaded.work} /> : <p className="muted frame-loading">{t("app.loading")}</p>}
          <Notice />
        </main>
      ) : section === "ideate" ? (
        <main id="main" className="frame-main frame-main-wide">
          {loaded.state === "ready" ? <Ideate key={loaded.work.id} work={loaded.work} /> : <p className="muted frame-loading">{t("app.loading")}</p>}
          <Notice />
        </main>
      ) : (
        <main id="main" className="frame-main">
          <SectionPlaceholder section={section} />
          <Notice />
        </main>
      )}
    </div>
  );
}
