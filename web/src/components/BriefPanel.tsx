import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { errorText, request } from "../api";
import { workPath } from "../sections";
import type { WriteContext } from "../pages/Write";

// The scene brief (plan 5.9 B, mockup Write.dc.html "Brief"): what the
// assistant keeps in mind for this chapter. Unticking an item leaves its fact
// out of what the assistant is given; established facts always stay.

export const BRIEF_SECTIONS = ["people", "places", "relations", "rules", "threads", "others"] as const;

interface BriefItem {
  factId: string;
  label: string;
  detail: string;
  reason: "named" | "event" | "between" | "always" | "happens" | "open" | "payoff" | "elsewhere";
  excludable: boolean;
}

interface Brief {
  chapterId: string;
  goal: { text: string; source: "planning" | "scenes" | "" };
  sections: Array<{ key: (typeof BRIEF_SECTIONS)[number]; items: BriefItem[] }>;
  excluded: string[];
}

const chapterBase = (workId: string, chapterId: string) => `/api/works/${encodeURIComponent(workId)}/chapters/${encodeURIComponent(chapterId)}`;

export function BriefPanel({ context }: { context: WriteContext }) {
  const { t } = useTranslation();
  const { work, chapter } = context;
  const [brief, setBrief] = useState<Brief | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const { brief: loaded } = await request<{ brief: Brief }>(`${chapterBase(work.id, chapter.id)}/brief`);
      setBrief(loaded);
      setExcluded(new Set(loaded.excluded));
    } catch (cause) {
      setError(errorText(t, cause));
    }
  }, [work.id, chapter.id, t]);

  // Read afresh whenever the tab opens or the chapter changes: cards may have changed meanwhile.
  useEffect(() => {
    setBrief(null);
    void load();
  }, [load]);

  async function toggle(factId: string) {
    const next = new Set(excluded);
    if (next.has(factId)) next.delete(factId);
    else next.add(factId);
    setExcluded(next);
    setBusy(true);
    setError("");
    try {
      await context.flush();
      await request(chapterBase(work.id, chapter.id), {
        method: "PATCH",
        body: JSON.stringify({ baseRevision: context.currentChapter().revision, briefExcluded: [...next] })
      });
    } catch (cause) {
      setExcluded(excluded);
      setError(errorText(t, cause));
    } finally {
      setBusy(false);
    }
  }

  if (!brief) {
    return (
      <div className="brief" data-testid="brief">
        {error ? <p className="notice" role="alert" data-testid="brief-error">{error}</p> : <p className="muted">{t("app.loading")}</p>}
      </div>
    );
  }

  const sections = brief.sections.filter((section) => section.items.length && section.key !== "others");
  const others = brief.sections.find((section) => section.key === "others")?.items ?? [];
  const language = work.language;

  return (
    <div className="brief" data-testid="brief" data-excluded={excluded.size}>
      <p className="muted assist-hint brief-intro">{t("brief.intro")}</p>

      <section className="brief-section" data-testid="brief-goal">
        <div className="caps">{t("brief.goal")}</div>
        {brief.goal.text
          ? <p className="brief-goal" lang={language}>{brief.goal.text}</p>
          : <p className="muted brief-empty">{t("brief.noGoal")}</p>}
      </section>

      {[...sections, ...(others.length ? [{ key: "others" as const, items: others }] : [])].map((section) => {
        const list = (
          <ul className="brief-items">
            {section.items.map((entry) => {
              const included = !entry.factId || !excluded.has(entry.factId);
              return (
                <li key={entry.factId || entry.label} className={included ? "brief-item" : "brief-item off"} data-testid="brief-item" data-fact-id={entry.factId} data-state={included ? "on" : "off"}>
                  {entry.excludable ? (
                    <input
                      type="checkbox"
                      id={`brief-${entry.factId}`}
                      checked={included}
                      disabled={busy}
                      onChange={() => void toggle(entry.factId)}
                      data-testid="brief-toggle"
                    />
                  ) : <span className="brief-lock" aria-hidden="true">·</span>}
                  <label htmlFor={entry.excludable ? `brief-${entry.factId}` : undefined} className="brief-label">
                    <span className="brief-name" lang={language}>{entry.label}</span>
                    {entry.detail ? <span className="muted brief-detail" lang={language}>{entry.detail}</span> : null}
                    <span className="brief-reason">{t(`brief.reasons.${entry.reason}`)}{entry.excludable ? "" : ` · ${t("brief.kept")}`}{!entry.factId ? ` · ${t("brief.noCard")}` : ""}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        );
        return section.key === "others" ? (
          <details key="others" className="brief-section brief-others" data-testid="brief-others">
            <summary className="caps">{t("brief.sections.others", { count: section.items.length })}</summary>
            <p className="muted assist-hint">{t("brief.othersHint")}</p>
            {list}
          </details>
        ) : (
          <section key={section.key} className="brief-section" data-testid={`brief-${section.key}`}>
            <div className="caps">{t(`brief.sections.${section.key}`)}</div>
            {list}
          </section>
        );
      })}

      {sections.length === 0 && others.length === 0 ? (
        <p className="muted brief-empty" data-testid="brief-empty">
          {t("brief.empty")} <Link to={workPath(work.id, "cast")}>{t("brief.openCast")}</Link>
        </p>
      ) : null}
      {error ? <p className="notice" role="alert" data-testid="brief-error">{error}</p> : null}
    </div>
  );
}
