import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { ApiError, errorText, type WorkSummary } from "../api";
import { Ornament } from "../components/common";
import Manuscript, { type ManuscriptHandle } from "../components/Manuscript";
import { formatCount } from "../format";
import { usePreferences } from "../preferences";
import { manuscriptLength, writeApi, type Chapter, type Work } from "../writeApi";

type SaveState = "saved" | "saving" | "error" | "conflict";

export interface WriteContext {
  work: Work;
  chapter: Chapter;
  getEditor: () => ManuscriptHandle | null;
  /** The open chapter as last saved (its revision moves on with every save). */
  currentChapter: () => Chapter;
  /** The story as this page last read or saved it. */
  currentWork: () => Work;
  /** Saves pending edits; resolves once the server has them (or rejects). */
  flush: () => Promise<void>;
  /** Re-reads the story from the server and shows the given chapter text. */
  reload: () => Promise<void>;
  busy: boolean;
}

interface WriteProps {
  summary: WorkSummary;
  /** The writing companion (AI, checks); rendered beside the manuscript. */
  companion?: (context: WriteContext) => ReactNode;
}

const SAVE_DELAY_MS = 800;

export default function Write({ summary, companion }: WriteProps) {
  const { t } = useTranslation();
  const { locale } = usePreferences();
  const [params, setParams] = useSearchParams();
  const [work, setWork] = useState<Work | null>(null);
  const [loadError, setLoadError] = useState("");
  const [title, setTitle] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState("");
  const [length, setLength] = useState(0);
  const [contentKey, setContentKey] = useState("");
  const [focus, setFocus] = useState(false);
  const [trash, setTrash] = useState<Chapter[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const editorRef = useRef<ManuscriptHandle | null>(null);
  const workRef = useRef<Work | null>(null);
  const dirtyRef = useRef(false);
  const editVersionRef = useRef(0);
  const timerRef = useRef<number | undefined>(undefined);
  const savingRef = useRef<Promise<void> | null>(null);

  // The open chapter lives in state (the URL follows it), so the editor and
  // the chapter it shows always change together.
  const [chapterId, setChapterId] = useState(() => params.get("chapter") ?? "");
  workRef.current = work;
  const chapter = work?.chapters.find((item) => item.id === chapterId) ?? work?.chapters[0] ?? null;
  const language = summary.language;

  const showChapter = useCallback((next: Chapter | null) => {
    dirtyRef.current = false;
    setChapterId(next?.id ?? "");
    if (next) setParams({ chapter: next.id }, { replace: true });
    setTitle(next?.title ?? "");
    setLength(manuscriptLength(next?.content ?? "", language));
    setSaveState("saved");
    setContentKey(next ? `${next.id}:${next.revision}:${Date.now()}` : "");
  }, [language, setParams]);

  const load = useCallback(async (preferredChapterId?: string) => {
    const { work: fresh } = await writeApi.work(summary.id);
    setWork(fresh);
    const wanted = preferredChapterId ?? chapterId;
    const next = fresh.chapters.find((item) => item.id === wanted) ?? fresh.chapters[0] ?? null;
    showChapter(next);
    return fresh;
  }, [summary.id, chapterId, showChapter]);

  useEffect(() => {
    load().catch((cause) => setLoadError(errorText(t, cause)));
    return () => window.clearTimeout(timerRef.current);
    // Load once per story; chapter switches are handled by `openChapter`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary.id]);

  // ---- Saving -------------------------------------------------------------

  const saveNow = useCallback(async (): Promise<void> => {
    window.clearTimeout(timerRef.current);
    if (savingRef.current) await savingRef.current.catch(() => undefined);
    const current = workRef.current;
    const target = current?.chapters.find((item) => item.id === (chapter?.id ?? ""));
    if (!current || !target || !dirtyRef.current || !editorRef.current) return;
    const startedAt = editVersionRef.current;
    const change = { title: title.trim() || target.title, richContent: editorRef.current.contents() };
    setSaveState("saving");
    const run = (async () => {
      try {
        const { chapter: saved, work: savedWork } = await writeApi.saveChapter(current.id, target.id, target.revision, change);
        // A new title changes the chapter list's revision; keep it so later
        // structure edits are checked against what this page has seen.
        const next = workRef.current && {
          ...workRef.current,
          structureRevision: savedWork?.structureRevision ?? workRef.current.structureRevision,
          chapters: workRef.current.chapters.map((item) => (item.id === saved.id ? saved : item))
        };
        workRef.current = next;
        setWork(next);
        if (editVersionRef.current === startedAt) {
          dirtyRef.current = false;
          setSaveState("saved");
        }
        setSaveError("");
      } catch (cause) {
        const conflict = cause instanceof ApiError && cause.status === 409;
        setSaveState(conflict ? "conflict" : "error");
        setSaveError(errorText(t, cause));
        throw cause;
      }
    })();
    savingRef.current = run;
    try {
      await run;
    } finally {
      if (savingRef.current === run) savingRef.current = null;
    }
  }, [chapter?.id, title, t]);

  // The latest saveNow, for timers and unmount.
  const saveRef = useRef(saveNow);
  saveRef.current = saveNow;

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    editVersionRef.current += 1;
    setSaveState("saving");
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void saveRef.current().catch(() => undefined), SAVE_DELAY_MS);
  }, []);

  const flush = useCallback(async () => {
    if (dirtyRef.current) await saveRef.current();
  }, []);

  // Save when leaving the page; warn if the browser is closed with unsaved text.
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      if (dirtyRef.current) void saveRef.current().catch(() => undefined);
    };
  }, []);

  function onEdit() {
    setLength(manuscriptLength(editorRef.current?.text() ?? "", language));
    scheduleSave();
  }

  // ---- Conflicts ----------------------------------------------------------

  /** Keep this window's text: save it on top of the version saved elsewhere (that version stays in history). */
  async function keepMine() {
    if (!chapter) return;
    setBusy(true);
    try {
      const { work: fresh } = await writeApi.work(summary.id);
      setWork(fresh);
      workRef.current = fresh;
      dirtyRef.current = true;
      await saveRef.current();
    } catch (cause) {
      setSaveError(errorText(t, cause));
    } finally {
      setBusy(false);
    }
  }

  async function useSaved() {
    setBusy(true);
    try {
      await load(chapter?.id);
      setSaveError("");
    } catch (cause) {
      setSaveError(errorText(t, cause));
    } finally {
      setBusy(false);
    }
  }

  // ---- Chapters -----------------------------------------------------------

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await flush();
      await action();
    } catch (cause) {
      setNotice(errorText(t, cause));
    } finally {
      setBusy(false);
    }
  }

  const openChapter = (id: string) => run(async () => {
    showChapter(workRef.current?.chapters.find((item) => item.id === id) ?? null);
  });

  const addChapter = () => run(async () => {
    const { chapter: created } = await writeApi.addChapter(summary.id);
    await load(created.id);
    editorRef.current?.focus();
  });

  const deleteChapter = (target: Chapter) => run(async () => {
    if (!window.confirm(t("write.deleteConfirm", { title: target.title }))) return;
    const latest = workRef.current?.chapters.find((item) => item.id === target.id) ?? target;
    await writeApi.deleteChapter(summary.id, latest);
    // Stay on the open chapter unless that is the one going to the trash.
    const remaining = workRef.current?.chapters.filter((item) => item.id !== target.id) ?? [];
    const stay = chapter && chapter.id !== target.id ? chapter.id : remaining[0]?.id ?? "";
    await load(stay);
    if (trash) setTrash((await writeApi.trash(summary.id)).chapters);
  });

  const move = (target: Chapter, offset: number) => run(async () => {
    const current = workRef.current;
    if (!current) return;
    const ids = current.chapters.map((item) => item.id);
    const from = ids.indexOf(target.id);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    // The order shown here was read at `current.structureRevision`; if another
    // window changed the chapter list since, the server refuses (409) and we reload.
    try {
      await writeApi.reorder(summary.id, ids, current.structureRevision);
    } finally {
      const { work: reordered } = await writeApi.work(summary.id);
      setWork(reordered);
    }
  });

  const toggleTrash = () => run(async () => {
    setTrash(trash ? null : (await writeApi.trash(summary.id)).chapters);
  });

  const restore = (target: Chapter) => run(async () => {
    const { work: fresh } = await writeApi.work(summary.id);
    await writeApi.restoreChapter(summary.id, target.id, fresh.structureRevision);
    setTrash((await writeApi.trash(summary.id)).chapters);
    await load(target.id);
  });

  // Story settings (title, premise, language…) move the story's structure
  // revision; read the story again so later edits are checked against it.
  const settingsKey = [summary.title, summary.premise, summary.genre, summary.focus, summary.language].join(" ");
  const firstSettings = useRef(settingsKey);
  useEffect(() => {
    if (settingsKey === firstSettings.current) return;
    firstSettings.current = settingsKey;
    void run(() => load(chapter?.id).then(() => undefined));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsKey]);

  // A link elsewhere (search) may point at another chapter of this story.
  const wantedChapter = params.get("chapter") ?? "";
  useEffect(() => {
    if (!work || !wantedChapter || wantedChapter === chapter?.id) return;
    if (work.chapters.some((item) => item.id === wantedChapter)) void openChapter(wantedChapter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedChapter]);

  // ---- Focus mode ---------------------------------------------------------

  useEffect(() => {
    const root = document.documentElement;
    if (focus) root.dataset.focusMode = "on";
    else delete root.dataset.focusMode;
    if (!focus) return () => delete root.dataset.focusMode;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFocus(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      delete root.dataset.focusMode;
    };
  }, [focus]);

  // ---- Render -------------------------------------------------------------

  if (loadError) return <p className="notice" role="alert" data-testid="write-error">{loadError}</p>;
  if (!work) return <p className="muted frame-loading">{t("app.loading")}</p>;

  const unit = language === "en" ? "words" : "characters";
  const chapterNumber = chapter ? work.chapters.findIndex((item) => item.id === chapter.id) + 1 : 0;

  return (
    <div className="write" data-testid="write">
      <section className="write-chapters" aria-label={t("write.chapters")} data-testid="chapter-list">
        <div className="side-block-head">
          <h2 className="caps">{t("write.chapters")}</h2>
          <button type="button" className="btn" disabled={busy} onClick={() => void addChapter()} data-testid="chapter-add">{t("write.addChapter")}</button>
        </div>
        {work.chapters.length === 0 ? <p className="muted" data-testid="chapters-empty">{t("write.noChapters")}</p> : null}
        <ol className="chapter-items">
          {work.chapters.map((item, index) => (
            <li key={item.id} className={item.id === chapter?.id ? "chapter-item on" : "chapter-item"} data-testid="chapter-item" data-chapter-id={item.id} data-active={item.id === chapter?.id}>
              <button
                type="button"
                className="chapter-open"
                aria-current={item.id === chapter?.id ? "true" : undefined}
                disabled={busy}
                onClick={() => void openChapter(item.id)}
                data-testid="chapter-open"
              >
                <span className="num" aria-hidden="true">{index + 1}</span>
                <span lang={language}>{item.title}</span>
              </button>
              <span className="chapter-tools">
                <button type="button" className="btn quiet chapter-tool" disabled={busy || index === 0} onClick={() => void move(item, -1)} aria-label={t("write.moveUp", { title: item.title })} data-testid="chapter-up">↑</button>
                <button type="button" className="btn quiet chapter-tool" disabled={busy || index === work.chapters.length - 1} onClick={() => void move(item, 1)} aria-label={t("write.moveDown", { title: item.title })} data-testid="chapter-down">↓</button>
                <button type="button" className="btn quiet chapter-tool" disabled={busy} onClick={() => void deleteChapter(item)} aria-label={t("write.deleteChapter", { title: item.title })} data-testid="chapter-delete">×</button>
              </span>
            </li>
          ))}
        </ol>
        <button type="button" className="btn quiet trash-toggle" aria-expanded={trash !== null} disabled={busy} onClick={() => void toggleTrash()} data-testid="trash-toggle">{t("write.trash")}</button>
        {trash ? (
          <ul className="trash-items" data-testid="trash-list">
            {trash.length === 0 ? <li className="muted">{t("write.trashEmpty")}</li> : null}
            {trash.map((item) => (
              <li key={item.id} className="trash-item" data-testid="trash-item">
                <span lang={language}>{item.title}</span>
                <button type="button" className="btn quiet" disabled={busy} onClick={() => void restore(item)} data-testid="trash-restore">{t("write.restore")}</button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="write-desk" aria-label={t("write.manuscript")}>
        <div className="write-bar">
          <span className="muted save-state" data-testid="save-state" data-state={saveState} role="status">
            {saveState === "saving" ? t("write.saving") : saveState === "saved" ? t("write.saved") : t("write.notSaved")}
            {" · "}
            <span data-testid="chapter-length" data-count={length}>{t(`home.length.${unit}`, { count: length, formatted: formatCount(length, locale) })}</span>
          </span>
          <button type="button" className="btn quiet" aria-pressed={focus} onClick={() => setFocus(!focus)} data-testid="focus-toggle">
            {focus ? t("write.exitFocus") : t("write.focus")}
          </button>
        </div>

        {saveState === "conflict" || saveState === "error" ? (
          <div className="notice save-problem" role="alert" data-testid="save-problem" data-kind={saveState}>
            <p>{saveState === "conflict" ? t("write.conflict") : saveError}</p>
            <div className="draft-actions">
              {saveState === "conflict" ? (
                <>
                  <button type="button" className="btn primary" disabled={busy} onClick={() => void keepMine()} data-testid="conflict-keep-mine">{t("write.keepMine")}</button>
                  <button type="button" className="btn" disabled={busy} onClick={() => void useSaved()} data-testid="conflict-use-saved">{t("write.useSaved")}</button>
                </>
              ) : (
                <button type="button" className="btn" disabled={busy} onClick={() => void saveNow().catch(() => undefined)} data-testid="save-retry">{t("ideate.retry")}</button>
              )}
            </div>
          </div>
        ) : null}
        {notice ? <p className="notice" role="alert" data-testid="write-notice">{notice}</p> : null}

        {chapter ? (
          <article className="card page" data-testid="manuscript" data-chapter-id={chapter.id}>
            <header className="page-head">
              <div className="caps">{t("write.chapterNumber", { number: chapterNumber })}</div>
              <label className="visually-hidden" htmlFor="chapter-title">{t("write.chapterTitle")}</label>
              <input
                id="chapter-title"
                className="chapter-title display"
                value={title}
                lang={language}
                maxLength={150}
                onChange={(event) => {
                  setTitle(event.target.value);
                  scheduleSave();
                }}
                data-testid="chapter-title"
              />
              <Ornament width={140} />
            </header>
            <Manuscript
              ref={editorRef}
              initial={chapter.richContent}
              contentKey={contentKey}
              language={language}
              placeholder={t("write.placeholder")}
              label={t("write.manuscript")}
              onChange={onEdit}
            />
          </article>
        ) : null}
      </section>

      {chapter && companion ? (
        <aside className="write-companion" aria-label={t("write.companion")}>
          {companion({ work, chapter, getEditor: () => editorRef.current, currentChapter: () => workRef.current?.chapters.find((item) => item.id === chapter.id) ?? chapter, currentWork: () => workRef.current ?? work, flush, reload: () => load(chapter.id).then(() => undefined), busy })}
        </aside>
      ) : null}
    </div>
  );
}
