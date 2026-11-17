import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, errorText, type WorkSummary } from "../api";
import { MAX_BECAUSE, plotApi, SPINE_LINES, type Spine, type SpineLine, type SpineLines } from "../plotApi";

// Plot page, part 1: the story spine (plan 5.8, mockup Plot). Six sentences,
// one box each; "Because of that" may hold several. Each sentence is saved
// when the writer leaves its box. The AI can suggest ways to finish any one
// sentence from the story so far; nothing is kept until the writer picks one.

type Loaded = { state: "loading" } | { state: "ready" } | { state: "failed"; message: string };
type Status = "idle" | "saving" | "saved" | "error" | "conflict";
/** One box: a sentence, or one of the "because of that" sentences. */
type Row = { line: SpineLine; index: number; key: string };
type Asked = { key: string; state: "asking" } | { key: string; state: "ready"; items: string[] } | { key: string; state: "failed"; message: string };

const linesOf = (spine: Spine): SpineLines => ({ once: spine.once, everyDay: spine.everyDay, oneDay: spine.oneDay, because: spine.because, finally: spine.finally, everSince: spine.everSince });
const EMPTY: SpineLines = { once: "", everyDay: "", oneDay: "", because: [""], finally: "", everSince: "" };

function valueOf(lines: SpineLines, row: Row): string {
  return row.line === "because" ? lines.because[row.index] ?? "" : lines[row.line];
}

function withValue(lines: SpineLines, row: Row, value: string): SpineLines {
  if (row.line !== "because") return { ...lines, [row.line]: value };
  const because = [...lines.because];
  because[row.index] = value;
  return { ...lines, because };
}

export default function Plot({ work }: { work: WorkSummary }) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [draft, setDraftState] = useState<SpineLines>(EMPTY);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [asked, setAsked] = useState<Asked | null>(null);
  // The latest sentences, the revision they are based on, and what was last
  // sent, kept outside rendering so saves made one after another chain up.
  const draftRef = useRef<SpineLines>(EMPTY);
  const revision = useRef(0);
  const sent = useRef("");
  const conflict = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const setDraft = (next: SpineLines) => {
    draftRef.current = next;
    setDraftState(next);
  };

  const load = useCallback(async () => {
    const { spine } = await plotApi.spine(work.id);
    revision.current = spine.revision;
    sent.current = JSON.stringify(linesOf(spine));
    conflict.current = false;
    setDraft(linesOf(spine));
    setLoaded({ state: "ready" });
  }, [work.id]);

  useEffect(() => {
    load().catch((cause) => setLoaded({ state: "failed", message: errorText(t, cause) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  /** Saves what the boxes hold now, after any save still on its way. */
  function save(): Promise<void> {
    queue.current = queue.current.then(async () => {
      const lines = draftRef.current;
      const json = JSON.stringify(lines);
      if (conflict.current || json === sent.current) return;
      setStatus("saving");
      try {
        const { spine } = await plotApi.saveSpine(work.id, lines, revision.current);
        revision.current = spine.revision;
        sent.current = json;
        setStatus("saved");
      } catch (cause) {
        conflict.current = cause instanceof ApiError && cause.code === "REVISION_CONFLICT";
        setError(errorText(t, cause));
        setStatus(conflict.current ? "conflict" : "error");
      }
    });
    return queue.current;
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

  async function suggest(row: Row) {
    setAsked({ key: row.key, state: "asking" });
    // The AI reads the saved spine, so what is in the boxes is saved first.
    await save();
    if (conflict.current) {
      setAsked(null);
      return;
    }
    try {
      const { suggestions } = await plotApi.suggest(work.id, row.line, row.line === "because" ? row.index : undefined);
      setAsked({ key: row.key, state: "ready", items: suggestions });
    } catch (cause) {
      setAsked({ key: row.key, state: "failed", message: errorText(t, cause) });
    }
  }

  function choose(row: Row, text: string) {
    setDraft(withValue(draftRef.current, row, text));
    setAsked(null);
    void save();
  }

  function addBecause() {
    if (draftRef.current.because.length >= MAX_BECAUSE) return;
    setDraft({ ...draftRef.current, because: [...draftRef.current.because, ""] });
  }

  function removeBecause(index: number) {
    const because = draftRef.current.because.filter((_, at) => at !== index);
    setDraft({ ...draftRef.current, because: because.length ? because : [""] });
    setAsked(null);
    void save();
  }

  const rows: Row[] = SPINE_LINES.flatMap((line): Row[] =>
    line === "because" ? draft.because.map((_, index) => ({ line, index, key: `because:${index}` })) : [{ line, index: 0, key: line }]
  );
  const filled = rows.filter((row) => valueOf(draft, row).trim()).length;

  return (
    <div className="plot" data-testid="plot">
      <header className="cast-head">
        <div>
          <div className="caps">{t("plot.part")}</div>
          <h1 className="display page-title">{t("nav.plot")}</h1>
          <p className="page-subtitle muted">{t("plot.subtitle")}</p>
        </div>
      </header>
      <hr className="rule2" />

      {loaded.state === "loading" ? <p className="muted">{t("app.loading")}</p> : null}
      {loaded.state === "failed" ? <p className="notice" role="alert">{loaded.message}</p> : null}
      {loaded.state === "ready" ? (
        <section className="card spine" aria-labelledby="spine-title" data-testid="spine">
          <div className="spine-head">
            <div>
              <h2 id="spine-title" className="caps spine-title">{t("plot.spine.title")}</h2>
              <p className="muted assist-hint">{t("plot.spine.hint")}</p>
            </div>
            <span className="muted spine-status" role="status" data-testid="spine-status" data-status={status}>
              {status === "saving" ? t("write.saving") : status === "saved" ? t("plot.spine.saved") : t("plot.spine.count", { filled, total: rows.length })}
            </span>
          </div>
          {status === "error" || status === "conflict" ? (
            <div className="notice cast-error" role="alert" data-testid="spine-error">
              <span>{error}</span>
              {status === "conflict" ? <button type="button" className="btn" onClick={() => void loadSaved()}>{t("cast.loadSaved")}</button> : null}
            </div>
          ) : null}
          <ol className="spine-lines">
            {rows.map((row) => {
              const id = `spine-${row.key.replace(":", "-")}`;
              const here = asked?.key === row.key ? asked : null;
              return (
                <li key={row.key} className="spine-line" data-testid="spine-line" data-line={row.line} data-index={row.index}>
                  <label className="spine-opening" htmlFor={id}>{t(`plot.spine.lines.${row.line}`)}</label>
                  <div className="spine-body">
                    <textarea
                      id={id}
                      className="field spine-input"
                      rows={2}
                      maxLength={1000}
                      lang={work.language}
                      value={valueOf(draft, row)}
                      placeholder={t(`plot.spine.hints.${row.line}`)}
                      onChange={(change) => setDraft(withValue(draftRef.current, row, change.target.value))}
                      onBlur={() => void save()}
                      data-testid="spine-input"
                    />
                    <div className="spine-actions">
                      <button type="button" className="btn quiet" onClick={() => void suggest(row)} disabled={here?.state === "asking" || status === "conflict"} data-testid="spine-suggest">
                        {here?.state === "asking" ? t("plot.spine.asking") : t("plot.spine.suggest")}
                      </button>
                      {row.line === "because" && draft.because.length > 1 ? (
                        <button type="button" className="btn quiet" onClick={() => removeBecause(row.index)} data-testid="spine-remove">{t("plot.spine.remove")}</button>
                      ) : null}
                    </div>
                    {here?.state === "ready" ? (
                      <div className="spine-suggestions" role="group" aria-label={t("plot.spine.suggestionsLabel")} data-testid="spine-suggestions">
                        {here.items.map((item) => (
                          <button key={item} type="button" className="spine-suggestion" lang={work.language} onClick={() => choose(row, item)} data-testid="spine-suggestion">{item}</button>
                        ))}
                        <button type="button" className="btn quiet" onClick={() => setAsked(null)} data-testid="spine-dismiss">{t("plot.spine.dismiss")}</button>
                      </div>
                    ) : null}
                    {here?.state === "failed" ? <p className="notice" role="alert" data-testid="spine-suggest-error">{here.message}</p> : null}
                  </div>
                  {row.line === "because" && row.index === draft.because.length - 1 && draft.because.length < MAX_BECAUSE ? (
                    <button type="button" className="btn quiet spine-add" onClick={addBecause} data-testid="spine-add">{t("plot.spine.add")}</button>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
