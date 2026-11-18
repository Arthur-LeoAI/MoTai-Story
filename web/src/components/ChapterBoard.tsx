import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, errorText } from "../api";
import { writeApi, type Chapter, type Work } from "../writeApi";

// Chapter cards (plan 5.8, mockup Plot): one card per chapter, saying what the
// chapter must do, what stands in the way and what it leaves the reader with
// (`chapter.planning`). Cards sit in columns by state. A card moves to another
// column by dragging or with its buttons, and earlier or later in the book
// with its buttons; the chapter order is the book's order everywhere.

export const BOARD_COLUMNS = ["idea", "planned", "drafted", "done"] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];
const CARD_FIELDS = ["goal", "conflict", "hook"] as const;
type CardField = (typeof CARD_FIELDS)[number];
type CardDraft = { title: string; status: BoardColumn } & Record<CardField, string>;

/** A chapter's column: the state the writer chose, or one read from the chapter itself. */
export function columnOf(chapter: Chapter): BoardColumn {
  if ((BOARD_COLUMNS as readonly string[]).includes(chapter.status)) return chapter.status as BoardColumn;
  // Older chapters say only "draft": text means drafted, a plan means planned.
  if (chapter.content?.trim()) return "drafted";
  return chapter.planning?.goal?.trim() ? "planned" : "idea";
}

function CardDialog({ work, chapter, number, onClose, onSaved, onReload }: {
  work: Work;
  chapter: Chapter | null;
  number: number;
  onClose: () => void;
  onSaved: (chapter: Chapter) => void;
  onReload: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [draft, setDraft] = useState<CardDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (chapter) {
      setDraft({
        title: chapter.title,
        status: columnOf(chapter),
        goal: chapter.planning?.goal ?? "",
        conflict: chapter.planning?.conflict ?? "",
        hook: chapter.planning?.hook ?? ""
      });
      setError("");
      setConflict(false);
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) dialog.close();
  }, [chapter]);

  async function save(submit: FormEvent) {
    submit.preventDefault();
    if (!chapter || !draft) return;
    setBusy(true);
    setError("");
    setConflict(false);
    try {
      const { chapter: saved } = await writeApi.saveChapter(work.id, chapter.id, chapter.revision, {
        title: draft.title.trim() || chapter.title,
        status: draft.status,
        planning: { goal: draft.goal.trim(), conflict: draft.conflict.trim(), hook: draft.hook.trim() }
      });
      onSaved(saved);
      onClose();
    } catch (cause) {
      setError(errorText(t, cause));
      setConflict(cause instanceof ApiError && cause.code === "REVISION_CONFLICT");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialogRef} className="dialog cast-dialog" onClose={onClose} aria-labelledby="card-dialog-title" data-testid="card-dialog">
      {draft ? (
        <form onSubmit={save} className="dialog-body" noValidate>
          <h2 id="card-dialog-title" className="display dialog-title">{t("plot.board.cardTitle", { number })}</h2>
          <label className="caps" htmlFor="card-title">{t("plot.board.fields.title")}</label>
          <input id="card-title" className="field" maxLength={100} lang={work.language} value={draft.title} onChange={(change) => setDraft({ ...draft, title: change.target.value })} data-testid="card-title" />
          {CARD_FIELDS.map((field) => (
            <div key={field} className="dialog-field">
              <label className="caps" htmlFor={`card-${field}`}>{t(`plot.board.fields.${field}`)}</label>
              <textarea id={`card-${field}`} className="field" rows={2} maxLength={2000} lang={work.language} value={draft[field]} placeholder={t(`plot.board.hints.${field}`)} onChange={(change) => setDraft({ ...draft, [field]: change.target.value })} data-testid={`card-${field}`} />
            </div>
          ))}
          <fieldset className="dialog-fieldset">
            <legend className="caps">{t("plot.board.fields.status")}</legend>
            <div className="event-people">
              {BOARD_COLUMNS.map((status) => (
                <label key={status} className="scene-check">
                  <input type="radio" name="card-status" checked={draft.status === status} onChange={() => setDraft({ ...draft, status })} data-testid={`card-status-${status}`} />
                  <span>{t(`plot.board.columns.${status}`)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {error ? (
            <div className="notice cast-error" role="alert" data-testid="card-error">
              <span>{error}</span>
              {conflict ? <button type="button" className="btn" onClick={() => void onReload()} disabled={busy}>{t("cast.loadSaved")}</button> : null}
            </div>
          ) : null}
          <div className="dialog-row dialog-actions">
            <button type="submit" className="btn primary" disabled={busy} data-testid="card-save">{busy ? t("write.saving") : t("ideate.save")}</button>
            <button type="button" className="btn" onClick={onClose} disabled={busy} data-testid="card-cancel">{t("ideate.cancel")}</button>
          </div>
        </form>
      ) : null}
    </dialog>
  );
}

export function ChapterBoard({ workId }: { workId: string }) {
  const { t } = useTranslation();
  const [work, setWork] = useState<Work | null>(null);
  const [failed, setFailed] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState("");
  const [over, setOver] = useState<BoardColumn | "">("");

  const load = useCallback(async () => {
    const { work: full } = await writeApi.work(workId);
    setWork(full);
    return full;
  }, [workId]);

  useEffect(() => {
    load().catch((cause) => setFailed(errorText(t, cause)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const replace = (saved: Chapter) => setWork((current) => (current ? { ...current, chapters: current.chapters.map((chapter) => (chapter.id === saved.id ? { ...chapter, ...saved } : chapter)) } : current));

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(errorText(t, cause));
      // Whatever changed elsewhere, show it as it is now.
      if (cause instanceof ApiError && cause.code === "REVISION_CONFLICT") await load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  const move = (chapter: Chapter, status: BoardColumn) =>
    run(async () => {
      if (columnOf(chapter) === status) return;
      replace((await writeApi.saveChapter(workId, chapter.id, chapter.revision, { status })).chapter);
    });

  const shift = (index: number, by: -1 | 1) =>
    run(async () => {
      if (!work) return;
      const ids = work.chapters.map((chapter) => chapter.id);
      const target = index + by;
      if (target < 0 || target >= ids.length) return;
      [ids[index], ids[target]] = [ids[target], ids[index]];
      setWork((await writeApi.reorder(workId, ids, work.structureRevision)).work);
    });

  const add = () =>
    run(async () => {
      const { chapter } = await writeApi.addChapter(workId);
      await load();
      setOpenId(chapter.id);
    });

  function drop(column: BoardColumn, event: DragEvent) {
    event.preventDefault();
    setOver("");
    const chapter = work?.chapters.find((item) => item.id === event.dataTransfer.getData("text/plain"));
    if (chapter) void move(chapter, column);
  }

  if (failed) return <p className="notice" role="alert">{failed}</p>;
  if (!work) return <p className="muted">{t("app.loading")}</p>;
  const open = work.chapters.find((chapter) => chapter.id === openId) ?? null;

  return (
    <section className="board" aria-labelledby="board-title" data-testid="board">
      <div className="spine-head">
        <div>
          <h2 id="board-title" className="caps spine-title">{t("plot.board.title")}</h2>
          <p className="muted assist-hint">{t("plot.board.hint")}</p>
        </div>
        <button type="button" className="btn" onClick={() => void add()} disabled={busy} data-testid="board-add">{t("plot.board.add")}</button>
      </div>
      {error ? <p className="notice" role="alert" data-testid="board-error">{error}</p> : null}
      <div className="board-columns">
        {BOARD_COLUMNS.map((column, columnIndex) => {
          const cards = work.chapters.map((chapter, index) => ({ chapter, index })).filter(({ chapter }) => columnOf(chapter) === column);
          return (
            <section
              key={column}
              className={over === column ? "board-column over" : "board-column"}
              aria-label={t(`plot.board.columns.${column}`)}
              onDragOver={(event) => {
                event.preventDefault();
                setOver(column);
              }}
              onDragLeave={() => setOver("")}
              onDrop={(event) => drop(column, event)}
              data-testid="board-column"
              data-column={column}
            >
              <div className="board-column-head">
                <span className="caps">{t(`plot.board.columns.${column}`)}</span>
                <span className="muted">{cards.length}</span>
              </div>
              <ol className="board-cards">
                {cards.map(({ chapter, index }) => (
                  <li
                    key={chapter.id}
                    className="card board-card"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData("text/plain", chapter.id);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                    data-testid="board-card"
                    data-chapter-id={chapter.id}
                  >
                    <button type="button" className="board-card-open" onClick={() => setOpenId(chapter.id)} data-testid="board-card-open">
                      {/* "Chapter 1 / Chapter 1" says nothing twice: a title with its number stands alone. */}
                      {chapter.title.includes(String(index + 1)) ? null : <span className="caps">{t("plot.board.chapter", { number: index + 1 })}</span>}
                      <strong lang={work.language}>{chapter.title}</strong>
                      {chapter.planning?.goal ? <span lang={work.language}>{chapter.planning.goal}</span> : <span className="muted board-card-empty">{t("plot.board.noGoal")}</span>}
                      {chapter.planning?.hook ? <span className="muted board-card-hook" lang={work.language}>{t("plot.board.leaves", { hook: chapter.planning.hook })}</span> : null}
                    </button>
                    <div className="board-card-actions">
                      <button type="button" className="btn quiet" onClick={() => void shift(index, -1)} disabled={busy || index === 0} aria-label={t("plot.board.earlier", { title: chapter.title })} title={t("plot.board.earlier", { title: chapter.title })} data-testid="card-earlier">↑</button>
                      <button type="button" className="btn quiet" onClick={() => void shift(index, 1)} disabled={busy || index === work.chapters.length - 1} aria-label={t("plot.board.later", { title: chapter.title })} title={t("plot.board.later", { title: chapter.title })} data-testid="card-later">↓</button>
                      <button type="button" className="btn quiet" onClick={() => void move(chapter, BOARD_COLUMNS[columnIndex - 1])} disabled={busy || columnIndex === 0} aria-label={t("plot.board.back", { title: chapter.title })} title={t("plot.board.back", { title: chapter.title })} data-testid="card-back">←</button>
                      <button type="button" className="btn quiet" onClick={() => void move(chapter, BOARD_COLUMNS[columnIndex + 1])} disabled={busy || columnIndex === BOARD_COLUMNS.length - 1} aria-label={t("plot.board.forward", { title: chapter.title })} title={t("plot.board.forward", { title: chapter.title })} data-testid="card-forward">→</button>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>
      <CardDialog
        work={work}
        chapter={open}
        number={open ? work.chapters.indexOf(open) + 1 : 0}
        onClose={() => setOpenId("")}
        onSaved={replace}
        onReload={async () => {
          await load();
        }}
      />
    </section>
  );
}
