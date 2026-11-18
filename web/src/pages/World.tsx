import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, errorText, request, type WorkSummary } from "../api";
import { castApi, type Entity, type EntityDraft } from "../castApi";

// World page (plan 5.6): what makes this world different from ours. At the
// top, the world in a sentence; then the rules, each with three questions:
// the rule, what it costs or limits, and its exceptions. Rules are cards
// (type "rule"); every rule is a hard constraint for the AI's writing.

interface WorldSentence {
  what: string;
  here: string;
  revision: number;
}

const worldPath = (workId: string) => `/api/works/${encodeURIComponent(workId)}/world`;
export const worldApi = {
  read: (workId: string) => request<{ world: WorldSentence }>(worldPath(workId)),
  save: (workId: string, lines: { what: string; here: string }, baseRevision: number) =>
    request<{ world: WorldSentence }>(worldPath(workId), { method: "PUT", body: JSON.stringify({ lines, baseRevision }) })
};

type Status = "idle" | "saving" | "saved" | "error" | "conflict";
type RuleDraft = { rule: string; cost: string; exception: string; detail: string };
type Editing = { mode: "new" } | { mode: "edit"; rule: Entity } | null;

function Sentence({ workId, language }: { workId: string; language: string }) {
  const { t } = useTranslation();
  const [lines, setLinesState] = useState({ what: "", here: "" });
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const linesRef = useRef(lines);
  const revision = useRef(0);
  const sent = useRef("");
  const conflict = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const setLines = (next: { what: string; here: string }) => {
    linesRef.current = next;
    setLinesState(next);
  };

  const load = useCallback(async () => {
    const { world } = await worldApi.read(workId);
    revision.current = world.revision;
    conflict.current = false;
    const next = { what: world.what, here: world.here };
    sent.current = JSON.stringify(next);
    setLines(next);
    setReady(true);
  }, [workId]);

  useEffect(() => {
    load().catch((cause) => {
      setError(errorText(t, cause));
      setStatus("error");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  function save() {
    queue.current = queue.current.then(async () => {
      const json = JSON.stringify(linesRef.current);
      if (conflict.current || json === sent.current) return;
      setStatus("saving");
      try {
        const { world } = await worldApi.save(workId, linesRef.current, revision.current);
        revision.current = world.revision;
        sent.current = json;
        setStatus("saved");
      } catch (cause) {
        conflict.current = cause instanceof ApiError && cause.code === "REVISION_CONFLICT";
        setError(errorText(t, cause));
        setStatus(conflict.current ? "conflict" : "error");
      }
    });
  }

  async function loadSaved() {
    try {
      await load();
      setStatus("idle");
      setError("");
    } catch (cause) {
      setError(errorText(t, cause));
    }
  }

  return (
    <section className="card world-sentence" aria-labelledby="world-sentence-title" data-testid="world-sentence">
      <div className="spine-head">
        <h2 id="world-sentence-title" className="caps spine-title">{t("world.sentence.title")}</h2>
        <span className="muted spine-status" role="status" data-testid="world-status" data-status={status}>
          {status === "saving" ? t("write.saving") : status === "saved" ? t("plot.spine.saved") : ""}
        </span>
      </div>
      {ready ? (
        <p className="world-sentence-line display">
          <span>{t("world.sentence.before")}</span>
          <input className="field world-blank" aria-label={t("world.sentence.whatLabel")} maxLength={500} lang={language} value={lines.what} placeholder={t("world.sentence.whatHint")} onChange={(change) => setLines({ ...linesRef.current, what: change.target.value })} onBlur={save} data-testid="world-what" />
          <span>{t("world.sentence.middle")}</span>
          <input className="field world-blank" aria-label={t("world.sentence.hereLabel")} maxLength={500} lang={language} value={lines.here} placeholder={t("world.sentence.hereHint")} onChange={(change) => setLines({ ...linesRef.current, here: change.target.value })} onBlur={save} data-testid="world-here" />
          <span>{t("world.sentence.after")}</span>
        </p>
      ) : null}
      {status === "error" || status === "conflict" ? (
        <div className="notice cast-error" role="alert" data-testid="world-error">
          <span>{error}</span>
          {status === "conflict" ? <button type="button" className="btn" onClick={() => void loadSaved()}>{t("cast.loadSaved")}</button> : null}
        </div>
      ) : null}
    </section>
  );
}

function RuleDialog({ workId, language, editing, onClose, onChanged, onReload }: {
  workId: string;
  language: string;
  editing: Editing;
  onClose: () => void;
  onChanged: () => void;
  onReload: () => Promise<Entity | null>;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const empty: RuleDraft = { rule: "", cost: "", exception: "", detail: "" };
  const [draft, setDraft] = useState<RuleDraft>(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const rule = editing?.mode === "edit" ? editing.rule : null;
  const fill = (value: Entity | null) => setDraft(value ? { rule: value.name, cost: value.card.cost ?? "", exception: value.card.exception ?? "", detail: value.summary } : empty);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (editing && !dialog.open) {
      fill(rule);
      setError("");
      setConflict(false);
      dialog.showModal();
    } else if (!editing && dialog.open) dialog.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, rule]);

  async function save(submit: FormEvent) {
    submit.preventDefault();
    if (!draft.rule.trim()) {
      setError(t("world.rules.ruleRequired"));
      return;
    }
    const payload: EntityDraft = {
      name: draft.rule.trim(),
      aliases: rule?.aliases ?? [],
      summary: draft.detail.trim(),
      card: { cost: draft.cost.trim(), exception: draft.exception.trim() },
      notes: rule?.notes ?? ""
    };
    setBusy(true);
    setError("");
    setConflict(false);
    try {
      if (rule) await castApi.update(workId, rule, payload);
      else await castApi.create(workId, "rule", payload);
      onChanged();
      onClose();
    } catch (cause) {
      setError(errorText(t, cause));
      setConflict(cause instanceof ApiError && cause.code === "REVISION_CONFLICT");
    } finally {
      setBusy(false);
    }
  }

  async function loadSaved() {
    setBusy(true);
    try {
      const saved = await onReload();
      if (!saved) {
        onClose();
        return;
      }
      fill(saved);
      setError("");
      setConflict(false);
    } catch (cause) {
      setError(errorText(t, cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!rule || !window.confirm(t("world.rules.deleteConfirm"))) return;
    setBusy(true);
    try {
      await castApi.remove(workId, rule);
      onChanged();
      onClose();
    } catch (cause) {
      setError(errorText(t, cause));
      setConflict(cause instanceof ApiError && cause.code === "REVISION_CONFLICT");
    } finally {
      setBusy(false);
    }
  }

  const field = (key: keyof RuleDraft, rows: number, limit: number) => (
    <div className="dialog-field">
      <label className="caps" htmlFor={`rule-${key}`}>{t(`world.rules.fields.${key}`)}</label>
      <textarea id={`rule-${key}`} className="field" rows={rows} maxLength={limit} lang={language} value={draft[key]} placeholder={t(`world.rules.hints.${key}`)} onChange={(change) => setDraft({ ...draft, [key]: change.target.value })} data-testid={`rule-${key}`} />
    </div>
  );

  return (
    <dialog ref={dialogRef} className="dialog cast-dialog" onClose={onClose} aria-labelledby="rule-dialog-title" data-testid="rule-dialog">
      <form onSubmit={save} className="dialog-body" noValidate>
        <h2 id="rule-dialog-title" className="display dialog-title">{rule ? t("world.rules.editTitle") : t("world.rules.newTitle")}</h2>
        {field("rule", 2, 160)}
        {field("cost", 2, 2000)}
        {field("exception", 2, 2000)}
        <details className="cast-more">
          <summary className="caps">{t("world.rules.more")}</summary>
          {field("detail", 3, 600)}
        </details>
        {error ? (
          <div className="notice cast-error" role="alert" data-testid="rule-error">
            <span>{error}</span>
            {conflict ? <button type="button" className="btn" onClick={() => void loadSaved()} disabled={busy}>{t("cast.loadSaved")}</button> : null}
          </div>
        ) : null}
        <div className="dialog-row dialog-actions">
          <button type="submit" className="btn primary" disabled={busy} data-testid="rule-save">{busy ? t("write.saving") : t("ideate.save")}</button>
          <button type="button" className="btn" onClick={onClose} disabled={busy} data-testid="rule-cancel">{t("ideate.cancel")}</button>
          {rule ? <button type="button" className="btn quiet cast-delete" onClick={() => void remove()} disabled={busy} data-testid="rule-delete">{t("world.rules.delete")}</button> : null}
        </div>
      </form>
    </dialog>
  );
}

export default function World({ work }: { work: WorkSummary }) {
  const { t } = useTranslation();
  const [rules, setRules] = useState<Entity[] | null>(null);
  const [failed, setFailed] = useState("");
  const [editing, setEditing] = useState<Editing>(null);

  const load = useCallback(async () => {
    const { canon } = await castApi.canon(work.id);
    const next = canon.entities.filter((entity) => entity.type === "rule");
    setRules(next);
    return next;
  }, [work.id]);

  useEffect(() => {
    load().catch((cause) => setFailed(errorText(t, cause)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  return (
    <div className="world" data-testid="world">
      <header className="cast-head">
        <div>
          <div className="caps">{t("world.part")}</div>
          <h1 className="display page-title">{t("nav.world")}</h1>
          <p className="page-subtitle muted">{t("world.subtitle")}</p>
        </div>
      </header>
      <hr className="rule2" />

      <Sentence workId={work.id} language={work.language} />

      <section className="world-rules" aria-labelledby="rules-title" data-testid="rules">
        <div className="spine-head">
          <div>
            <h2 id="rules-title" className="caps spine-title">{t("world.rules.title")}</h2>
            <p className="muted assist-hint">{t("world.rules.hint")}</p>
          </div>
          <button type="button" className="btn primary" onClick={() => setEditing({ mode: "new" })} data-testid="rule-new">{t("world.rules.new")}</button>
        </div>
        {failed ? <p className="notice" role="alert">{failed}</p> : null}
        {rules === null && !failed ? <p className="muted">{t("app.loading")}</p> : null}
        {rules && rules.length === 0 ? <p className="muted cast-empty" data-testid="rules-empty">{t("world.rules.empty")}</p> : null}
        {rules && rules.length ? (
          <ul className="rule-cards">
            {rules.map((rule) => (
              <li key={rule.id}>
                <button type="button" className="card rule-card" onClick={() => setEditing({ mode: "edit", rule })} data-testid="rule-card" data-rule-id={rule.id}>
                  <span className="rule-row">
                    <span className="caps">{t("world.rules.fields.rule")}</span>
                    <strong lang={work.language}>{rule.name}</strong>
                  </span>
                  <span className="rule-row">
                    <span className="caps">{t("world.rules.short.cost")}</span>
                    {rule.card.cost ? <span lang={work.language}>{rule.card.cost}</span> : <span className="muted rule-missing">{t("world.rules.noCost")}</span>}
                  </span>
                  <span className="rule-row">
                    <span className="caps">{t("world.rules.short.exception")}</span>
                    {rule.card.exception ? <span lang={work.language}>{rule.card.exception}</span> : <span className="muted rule-missing">{t("world.rules.noException")}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <RuleDialog
        workId={work.id}
        language={work.language}
        editing={editing}
        onClose={() => setEditing(null)}
        onChanged={() => void load()}
        onReload={async () => {
          const fresh = await load();
          const id = editing?.mode === "edit" ? editing.rule.id : "";
          const rule = fresh.find((candidate) => candidate.id === id) ?? null;
          if (rule) setEditing({ mode: "edit", rule });
          return rule;
        }}
      />
    </div>
  );
}
