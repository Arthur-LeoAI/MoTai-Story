import { useState } from "react";
import { useTranslation } from "react-i18next";
import { errorText, request } from "../api";
import type { StoryEvent } from "../castApi";

// Timeline checks (plan 5.7): contradictions in what the story records, found
// without AI and read with the timeline; and "What's missing?", where the AI
// points out breaks in cause and effect. Nothing here changes the story.

export interface TimelineProblem {
  id: string;
  kind: "twoPlaces" | "afterDeath" | "payoffBeforePlant";
  eventIds: string[];
  setupId?: string;
  params: Record<string, string | number>;
}

export interface MissingLink {
  afterEventId: string;
  missing: string;
}

const base = (workId: string) => `/api/works/${encodeURIComponent(workId)}/timeline`;
export const timelineApi = {
  checks: (workId: string) => request<{ problems: TimelineProblem[] }>(`${base(workId)}/checks`),
  missing: (workId: string) => request<{ gaps: MissingLink[] }>(`${base(workId)}/missing`, { method: "POST", body: JSON.stringify({}) })
};

type Asked = { state: "idle" } | { state: "asking" } | { state: "ready"; gaps: MissingLink[] } | { state: "failed"; message: string };

export function TimelineChecks({ workId, language, problems, events, onOpen }: {
  workId: string;
  language: string;
  problems: TimelineProblem[];
  events: StoryEvent[];
  onOpen: (event: StoryEvent) => void;
}) {
  const { t } = useTranslation();
  const [asked, setAsked] = useState<Asked>({ state: "idle" });
  const byId = new Map(events.map((event) => [event.id, event]));

  async function ask() {
    setAsked({ state: "asking" });
    try {
      setAsked({ state: "ready", gaps: (await timelineApi.missing(workId)).gaps });
    } catch (cause) {
      setAsked({ state: "failed", message: errorText(t, cause) });
    }
  }

  const openButtons = (ids: string[]) =>
    ids.map((id) => byId.get(id)).filter((event): event is StoryEvent => Boolean(event)).map((event) => (
      <button key={event.id} type="button" className="btn quiet checks-open" onClick={() => onOpen(event)} lang={language} data-testid="check-open">
        {t("timeline.checks.open", { title: event.title })}
      </button>
    ));

  return (
    <section className="card checks" aria-labelledby="checks-title" data-testid="timeline-checks">
      <div className="spine-head">
        <h2 id="checks-title" className="caps spine-title">{t("timeline.checks.title")}</h2>
        <button type="button" className="btn" onClick={() => void ask()} disabled={asked.state === "asking" || events.length < 2} data-testid="missing-ask">
          {asked.state === "asking" ? t("timeline.checks.asking") : t("timeline.checks.ask")}
        </button>
      </div>
      {problems.length ? (
        <ul className="checks-list" data-testid="check-problems">
          {problems.map((problem) => (
            <li key={problem.id} className="checks-item problem" data-testid="check-problem" data-kind={problem.kind}>
              <span className="checks-dot" aria-hidden="true" />
              <div className="checks-text">
                <span lang={language}>{t(`timeline.checks.kinds.${problem.kind}`, problem.params)}</span>
                <span className="checks-actions">{openButtons(problem.eventIds)}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted assist-hint" data-testid="check-none">{t("timeline.checks.none")}</p>
      )}
      {events.length < 2 ? <p className="muted assist-hint">{t("timeline.checks.askHint")}</p> : null}
      {asked.state === "failed" ? <p className="notice" role="alert" data-testid="missing-error">{asked.message}</p> : null}
      {asked.state === "ready" ? (
        <div className="checks-missing" data-testid="missing">
          <div className="caps">{t("timeline.checks.missingTitle")}</div>
          {asked.gaps.length ? (
            <ul className="checks-list">
              {asked.gaps.map((gap, index) => {
                const after = byId.get(gap.afterEventId);
                return (
                  <li key={index} className="checks-item" data-testid="missing-gap" data-after={gap.afterEventId}>
                    <span className="checks-dot gap" aria-hidden="true" />
                    <div className="checks-text">
                      {after ? <span className="muted checks-after" lang={language}>{t("timeline.checks.after", { title: after.title })}</span> : null}
                      <span lang={language}>{gap.missing}</span>
                      {after ? <span className="checks-actions">{openButtons([after.id])}</span> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted assist-hint" data-testid="missing-none">{t("timeline.checks.nothingMissing")}</p>
          )}
          <p className="muted assist-hint">{t("timeline.checks.missingHint")}</p>
        </div>
      ) : null}
    </section>
  );
}
