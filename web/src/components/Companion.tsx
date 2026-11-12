import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { errorText } from "../api";
import {
  NEEDS_SELECTION,
  WRITE_MODES,
  assistApi,
  followTask,
  type CanonProposal,
  type GenerationResult,
  type Range,
  type Task,
  type WriteMode
} from "../assistApi";
import type { WriteContext } from "../pages/Write";

type Tab = "assist" | "checks";

interface Run {
  /** Chapter revision the result was generated from; it can only be merged onto that. */
  baseRevision: number;
  chapterId: string;
  result: GenerationResult;
  selected: Set<string>;
}

function Assistant({ context, onReviewQueued }: { context: WriteContext; onReviewQueued: (task: Task) => void }) {
  const { t } = useTranslation();
  const { work, chapter } = context;
  const [mode, setMode] = useState<WriteMode>("continue");
  const [instruction, setInstruction] = useState("");
  const [task, setTask] = useState<Task | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  // A result belongs to one chapter; switching chapters clears it.
  useEffect(() => {
    setRun(null);
    setError("");
    setNotice("");
  }, [chapter.id]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const generating = task !== null;

  async function generate() {
    const editor = context.getEditor();
    if (!editor || generating) return;
    const selection = editor.selection();
    const end = Math.max(0, editor.length() - 1);
    const needsSelection = NEEDS_SELECTION.includes(mode);
    if (needsSelection && (!selection || selection.length === 0)) {
      setError(t("assist.selectFirst"));
      return;
    }
    // "Continue" always adds at the end; the others work on the selection.
    const range: Range = mode === "continue" ? { index: end, length: 0 } : selection && selection.length ? selection : { index: selection?.index ?? end, length: 0 };
    const selectedText = range.length ? editor.textIn(range) : "";
    setError("");
    setNotice("");
    setRun(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await context.flush();
      const current = context.currentChapter();
      const { task: started } = await assistApi.start({
        workId: work.id,
        chapterId: current.id,
        baseRevision: current.revision,
        mode,
        instruction: instruction.trim(),
        selectedText,
        range
      });
      setTask(started);
      const result = await followTask(started, setTask, controller.signal);
      const hunks = result.generation.hunks ?? [];
      setRun({ baseRevision: current.revision, chapterId: current.id, result, selected: new Set(hunks.map((hunk) => hunk.id)) });
    } catch (cause) {
      setError(errorText(t, cause));
    } finally {
      setTask(null);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function stop() {
    if (task) void assistApi.cancel(task.id).catch(() => undefined);
    abortRef.current?.abort();
  }

  async function accept() {
    if (!run) return;
    setBusy(true);
    setError("");
    try {
      const merged = await assistApi.merge(work.id, run.chapterId, run.result.generation.id, run.baseRevision, [...run.selected]);
      setRun(null);
      await context.reload();
      setNotice(t("assist.accepted"));
      if (merged.reviewTask) onReviewQueued(merged.reviewTask);
    } catch (cause) {
      setError(errorText(t, cause));
    } finally {
      setBusy(false);
    }
  }

  async function markFalseAlarm(conflictId: string) {
    if (!run) return;
    const reason = window.prompt(t("assist.falseAlarmReason"));
    if (!reason?.trim()) return;
    setBusy(true);
    try {
      const updated = await assistApi.adjudicate(work.id, run.chapterId, run.result.generation.id, {
        conflictId,
        reason: reason.trim(),
        baseRevision: run.baseRevision,
        canonRevision: work.canonRevision
      });
      setRun({ ...run, result: { ...run.result, generation: updated.generation, canAccept: updated.canAccept } });
    } catch (cause) {
      setError(errorText(t, cause));
    } finally {
      setBusy(false);
    }
  }

  const hunks = run?.result.generation.hunks ?? [];
  const conflicts = run?.result.generation.conflicts ?? [];
  const openHard = conflicts.some((item) => item.severity === "hard" && item.status === "open");

  return (
    <div className="assist" data-testid="assistant">
      <label className="caps" htmlFor="assist-mode">{t("assist.what")}</label>
      <select id="assist-mode" className="field" value={mode} onChange={(event) => setMode(event.target.value as WriteMode)} disabled={generating} data-testid="assist-mode">
        {WRITE_MODES.map((item) => <option key={item} value={item}>{t(`assist.modes.${item}`)}</option>)}
      </select>
      <p className="muted assist-hint">{t(`assist.hints.${mode}`)}</p>
      <label className="caps" htmlFor="assist-instruction">{t("assist.tellPlainly")}</label>
      <textarea
        id="assist-instruction"
        className="field assist-instruction"
        rows={4}
        maxLength={4000}
        value={instruction}
        lang={work.language}
        placeholder={t("assist.instructionPlaceholder")}
        onChange={(event) => setInstruction(event.target.value)}
        disabled={generating}
        data-testid="assist-instruction"
      />
      <div className="draft-actions">
        {generating ? (
          <button type="button" className="btn" onClick={stop} data-testid="assist-stop">{t("ideate.stop")}</button>
        ) : (
          <button type="button" className="btn primary" disabled={context.busy || busy} onClick={() => void generate()} data-testid="assist-generate">{t("assist.generate")}</button>
        )}
        {task ? <span className="muted assist-status" role="status" data-testid="assist-status" data-status={task.status}>{t(`assist.status.${task.status}`)}</span> : null}
      </div>
      {error ? <p className="notice" role="alert" data-testid="assist-error">{error}</p> : null}
      {notice ? <p className="assist-done" role="status" data-testid="assist-notice">{notice}</p> : null}

      {run ? (
        <section className="card assist-result" data-testid="assist-result" data-can-accept={run.result.canAccept} data-rewrites={run.result.generation.rewriteCount}>
          <div className="caps">{t("assist.result")}</div>
          {hunks.length > 1 ? <p className="muted assist-hint">{t("assist.chooseChanges")}</p> : null}
          {hunks.length === 0 ? <p className="muted assist-hint" data-testid="assist-no-change">{t("assist.noChange")}</p> : null}
          <div className="hunks">
            {hunks.map((hunk) => (
              <label key={hunk.id} className="hunk" data-testid="assist-hunk">
                {hunks.length > 1 ? (
                  <input
                    type="checkbox"
                    checked={run.selected.has(hunk.id)}
                    onChange={() => {
                      const selected = new Set(run.selected);
                      if (selected.has(hunk.id)) selected.delete(hunk.id);
                      else selected.add(hunk.id);
                      setRun({ ...run, selected });
                    }}
                    data-testid="assist-hunk-checkbox"
                  />
                ) : null}
                <span className="hunk-body">
                  {hunk.before ? <del className="hunk-before" lang={work.language}>{hunk.before}</del> : null}
                  <ins className="hunk-after" lang={work.language} data-testid="assist-hunk-after">{hunk.after}</ins>
                </span>
              </label>
            ))}
          </div>

          <div className="checks-report" data-testid="assist-checks" data-state={conflicts.length ? "conflicts" : "passed"}>
            {conflicts.length === 0 ? <p className="muted">{t("assist.checksPassed")}</p> : null}
            {conflicts.map((conflict) => (
              <div key={conflict.id || conflict.message} className={`conflict conflict-${conflict.severity}`} data-testid="assist-conflict" data-severity={conflict.severity} data-status={conflict.status}>
                <div className="caps">{t(`assist.severity.${conflict.severity}`)} · {t(`assist.conflictStatus.${conflict.status}`)}</div>
                <div lang={work.language}>{conflict.message}</div>
                {conflict.evidence[0]?.excerpt ? <blockquote lang={work.language}>{conflict.evidence[0].excerpt}</blockquote> : null}
                {conflict.status === "open" && conflict.id ? (
                  <button type="button" className="btn quiet" disabled={busy} onClick={() => void markFalseAlarm(conflict.id)} data-testid="assist-false-alarm">{t("assist.falseAlarm")}</button>
                ) : null}
              </div>
            ))}
          </div>

          <div className="draft-actions">
            <button
              type="button"
              className="btn primary"
              disabled={busy || !run.result.canAccept || run.selected.size === 0}
              onClick={() => void accept()}
              data-testid="assist-accept"
            >
              {openHard ? t("assist.blocked") : t("assist.accept")}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void generate()} data-testid="assist-regenerate">{t("assist.again")}</button>
            <button type="button" className="btn quiet" disabled={busy} onClick={() => setRun(null)} data-testid="assist-discard">{t("draft.discard")}</button>
          </div>
          <p className="muted assist-hint">{t("assist.unchanged")}</p>
        </section>
      ) : null}
    </div>
  );
}

function Checks({ context, refreshKey }: { context: WriteContext; refreshKey: number }) {
  const { t } = useTranslation();
  const { work, chapter } = context;
  const [proposals, setProposals] = useState<CanonProposal[] | null>(null);
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function refresh() {
    const all = await assistApi.proposals(work.id);
    const pending = all.filter((item) => item.status === "pending" && item.chapterId === chapter.id && item.changes.length);
    setProposals(pending);
    setSelected(Object.fromEntries(pending.map((item) => [item.id, new Set(item.changes.map((change) => change.fact.id))])));
  }

  useEffect(() => {
    refresh().catch((cause) => setError(errorText(t, cause)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter.id, refreshKey]);

  async function act(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await refresh();
      setNotice(message);
    } catch (cause) {
      setError(errorText(t, cause));
    } finally {
      setBusy(false);
    }
  }

  const review = () => act(async () => {
    await context.flush();
    await assistApi.review(work.id, chapter.id, context.currentChapter().revision);
  }, t("checks.reviewed"));

  return (
    <div className="checks" data-testid="checks">
      <p className="muted assist-hint">{t("checks.intro")}</p>
      <button type="button" className="btn" disabled={busy || context.busy} onClick={() => void review()} data-testid="checks-review">
        {busy ? t("checks.reviewing") : t("checks.review")}
      </button>
      {error ? <p className="notice" role="alert" data-testid="checks-error">{error}</p> : null}
      {notice ? <p className="assist-done" role="status" data-testid="checks-notice">{notice}</p> : null}
      {proposals === null ? <p className="muted">{t("app.loading")}</p> : null}
      {proposals?.length === 0 ? <p className="muted" data-testid="checks-empty">{t("checks.nothingPending")}</p> : null}
      {proposals?.map((proposal) => {
        const chosen = selected[proposal.id] ?? new Set<string>();
        return (
          <section key={proposal.id} className="card fact-proposal" data-testid="fact-proposal">
            <div className="caps">{t("checks.newFacts")}</div>
            {proposal.changes.map((change) => (
              <label key={change.fact.id} className="fact" data-testid="fact-item">
                <input
                  type="checkbox"
                  checked={chosen.has(change.fact.id)}
                  onChange={() => {
                    const next = new Set(chosen);
                    if (next.has(change.fact.id)) next.delete(change.fact.id);
                    else next.add(change.fact.id);
                    setSelected({ ...selected, [proposal.id]: next });
                  }}
                  data-testid="fact-checkbox"
                />
                <span lang={work.language}><strong>{change.fact.predicate}</strong> {change.fact.value}</span>
              </label>
            ))}
            <div className="draft-actions">
              <button type="button" className="btn primary" disabled={busy} onClick={() => void act(() => assistApi.confirmFacts(work.id, proposal.id, [...chosen]), t("checks.confirmed"))} data-testid="fact-confirm">
                {t("checks.confirm", { count: chosen.size })}
              </button>
              <button type="button" className="btn quiet" disabled={busy} onClick={() => void act(() => assistApi.rejectFacts(work.id, proposal.id), t("checks.rejected"))} data-testid="fact-reject">{t("checks.reject")}</button>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** The writing companion beside the manuscript: AI assistant and checks. */
export default function Companion({ context }: { context: WriteContext }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("assist");
  const [checksKey, setChecksKey] = useState(0);
  const reviewAbort = useRef<AbortController | null>(null);
  useEffect(() => () => reviewAbort.current?.abort(), []);

  // Accepting AI text queues a review of the chapter; its new facts appear in Checks when it ends.
  function followReview(task: Task) {
    reviewAbort.current?.abort();
    const controller = new AbortController();
    reviewAbort.current = controller;
    followTask(task, () => undefined, controller.signal)
      .catch(() => undefined)
      .finally(() => {
        if (!controller.signal.aborted) setChecksKey((key) => key + 1);
      });
  }

  return (
    <div className="companion" data-testid="companion">
      <div role="tablist" aria-label={t("write.companion")} className="tabs">
        {(["assist", "checks"] as const).map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            id={`tab-${item}`}
            aria-selected={tab === item}
            aria-controls={`panel-${item}`}
            className={tab === item ? "btn on" : "btn"}
            onClick={() => setTab(item)}
            data-testid={`tab-${item}`}
          >
            {t(`companion.${item}`)}
          </button>
        ))}
      </div>
      <hr className="rule" />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {/* Both stay mounted so a running generation survives a tab switch. */}
        <div hidden={tab !== "assist"}>
          <Assistant context={context} onReviewQueued={followReview} />
        </div>
        <div hidden={tab !== "checks"}>
          <Checks context={context} refreshKey={checksKey} />
        </div>
      </div>
    </div>
  );
}
