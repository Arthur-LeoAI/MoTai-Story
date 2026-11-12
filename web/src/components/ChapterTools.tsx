import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { errorText } from "../api";
import { formatRelativeTime } from "../format";
import { usePreferences } from "../preferences";
import type { WriteContext } from "../pages/Write";
import { request } from "../api";

// ---------------------------------------------------------------------------
// Chapter history: named versions, compare, restore.

interface Revision {
  id: string;
  name: string;
  /** Why the version was kept: auto, manual, ai, restore, delete, import. */
  source: string;
  createdAt: string;
  characters: number;
}

const chapterBase = (workId: string, chapterId: string) =>
  `/api/works/${encodeURIComponent(workId)}/chapters/${encodeURIComponent(chapterId)}`;

const SOURCES = new Set(["auto", "manual", "ai", "restore", "delete", "import"]);

export function HistoryPanel({ context }: { context: WriteContext }) {
  const { t } = useTranslation();
  const { locale } = usePreferences();
  const { work, chapter } = context;
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const [name, setName] = useState("");
  const [comparing, setComparing] = useState<{ revision: Revision; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function refresh() {
    const result = await request<{ revisions: Revision[] }>(`${chapterBase(work.id, chapter.id)}/revisions`);
    setRevisions([...(result.revisions ?? [])].reverse());
  }

  useEffect(() => {
    setComparing(null);
    refresh().catch((cause) => setError(errorText(t, cause)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter.id, chapter.revision]);

  async function act(action: () => Promise<void>, done = "") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      if (done) setNotice(done);
    } catch (cause) {
      setError(errorText(t, cause));
    } finally {
      setBusy(false);
    }
  }

  const save = (event: FormEvent) => {
    event.preventDefault();
    void act(async () => {
      await context.flush();
      await request(`${chapterBase(work.id, chapter.id)}/revisions`, {
        method: "POST",
        body: JSON.stringify({ baseRevision: context.currentChapter().revision, name: name.trim() })
      });
      setName("");
      await refresh();
    }, t("history.savedVersion"));
  };

  const compare = (revision: Revision) => act(async () => {
    const result = await request<{ chapter: { content: string } }>(`${chapterBase(work.id, chapter.id)}/revisions/${encodeURIComponent(revision.id)}`);
    setComparing({ revision, text: result.chapter.content });
  });

  const restore = (revision: Revision) => act(async () => {
    await context.flush();
    await request(`${chapterBase(work.id, chapter.id)}/revisions/${encodeURIComponent(revision.id)}/restore`, {
      method: "POST",
      body: JSON.stringify({ baseRevision: context.currentChapter().revision })
    });
    setComparing(null);
    await context.reload();
  }, t("history.restored"));

  const label = (revision: Revision) =>
    revision.name || t(`history.sources.${SOURCES.has(revision.source) ? revision.source : "auto"}`);

  return (
    <div className="history" data-testid="history">
      <p className="muted assist-hint">{t("history.intro")}</p>
      <form className="history-save" onSubmit={save}>
        <label className="visually-hidden" htmlFor="version-name">{t("history.nameLabel")}</label>
        <input
          id="version-name"
          className="field"
          maxLength={80}
          value={name}
          placeholder={t("history.namePlaceholder")}
          onChange={(event) => setName(event.target.value)}
          data-testid="version-name"
        />
        <button type="submit" className="btn" disabled={busy || context.busy} data-testid="version-save">{t("history.save")}</button>
      </form>
      {error ? <p className="notice" role="alert" data-testid="history-error">{error}</p> : null}
      {notice ? <p className="assist-done" role="status" data-testid="history-notice">{notice}</p> : null}

      {comparing ? (
        <section className="card compare" data-testid="version-compare">
          <div className="compare-columns">
            <div>
              <div className="caps">{label(comparing.revision)}</div>
              <div className="compare-text" lang={work.language} data-testid="version-old">{comparing.text}</div>
            </div>
            <div>
              <div className="caps">{t("history.current")}</div>
              <div className="compare-text" lang={work.language}>{context.getEditor()?.text() ?? ""}</div>
            </div>
          </div>
          <div className="draft-actions">
            <button type="button" className="btn primary" disabled={busy} onClick={() => void restore(comparing.revision)} data-testid="version-restore">{t("history.restore")}</button>
            <button type="button" className="btn quiet" onClick={() => setComparing(null)}>{t("ideate.cancel")}</button>
          </div>
          <p className="muted assist-hint">{t("history.restoreNote")}</p>
        </section>
      ) : null}

      {revisions?.length === 0 ? <p className="muted" data-testid="history-empty">{t("history.empty")}</p> : null}
      <ul className="version-list">
        {revisions?.map((revision) => (
          <li key={revision.id} className="version" data-testid="version-row" data-source={revision.source}>
            <span>
              <span className="version-name">{label(revision)}</span>
              <span className="muted version-meta">{formatRelativeTime(revision.createdAt, locale)}</span>
            </span>
            <button type="button" className="btn quiet" disabled={busy} onClick={() => void compare(revision)} data-testid="version-compare-open">{t("history.compare")}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scenes: the plan for the parts of a chapter.

export interface Scene {
  id?: string;
  title: string;
  status: "planned" | "draft" | "done";
  goal: string;
  conflict: string;
  must: string;
  mustNot: string;
  ending: string;
  location: string;
  participants: string;
  timeLabel: string;
  flashback: boolean;
  targetCharacters: number;
  povId: string;
  storyTime: number | null;
  start: number;
  end: number;
  needsRelocation?: boolean;
}

const SCENE_TEXT_FIELDS = ["goal", "conflict", "must", "mustNot", "ending"] as const;
const SCENE_LINE_FIELDS = ["location", "participants", "timeLabel"] as const;
const STATUSES = ["planned", "draft", "done"] as const;

export function ScenesPanel({ context }: { context: WriteContext }) {
  const { t } = useTranslation();
  const { work, chapter } = context;
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [editing, setEditing] = useState<{ index: number; scene: Scene } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setScenes(structuredClone((context.currentChapter() as { scenes?: Scene[] }).scenes ?? []));
    setEditing(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter.id, chapter.revision]);

  async function saveScenes(next: Scene[]) {
    setBusy(true);
    setError("");
    try {
      await context.flush();
      // The scene list was read with these revisions; if another window changed
      // the chapter or its plan since, the server refuses (409) instead of
      // overwriting it, and the panel reloads.
      const saved = await request<{ chapter: { scenes?: Scene[] } }>(`${chapterBase(work.id, chapter.id)}/scenes`, {
        method: "PATCH",
        body: JSON.stringify({ baseRevision: context.currentChapter().revision, structureRevision: context.currentWork().structureRevision, scenes: next })
      }).catch(async (cause) => {
        await context.reload();
        throw cause;
      });
      // Scene edits do not move the chapter's revision, so show what the server kept.
      setScenes(structuredClone(saved.chapter?.scenes ?? next));
      setEditing(null);
      await context.reload();
    } catch (cause) {
      setError(errorText(t, cause));
    } finally {
      setBusy(false);
    }
  }

  function newScene(): Scene {
    const end = Math.max(0, (context.getEditor()?.length() ?? 1) - 1);
    return {
      title: "", status: "planned", goal: "", conflict: "", must: "", mustNot: "", ending: "",
      location: "", participants: "", timeLabel: "", flashback: false, targetCharacters: 800,
      povId: "", storyTime: null, start: end, end
    };
  }

  function useSelection() {
    const selection = context.getEditor()?.selection();
    if (!editing || !selection) return;
    setEditing({ ...editing, scene: { ...editing.scene, start: selection.index, end: selection.index + selection.length, needsRelocation: false } });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    const scene = { ...editing.scene, title: editing.scene.title.trim() || t("scenes.untitled") };
    const next = [...scenes];
    if (editing.index < 0) next.push(scene);
    else next[editing.index] = scene;
    void saveScenes(next);
  }

  function move(index: number, offset: number) {
    const next = [...scenes];
    const to = index + offset;
    if (to < 0 || to >= next.length) return;
    next.splice(to, 0, next.splice(index, 1)[0]);
    void saveScenes(next);
  }

  function remove(index: number) {
    if (!window.confirm(t("scenes.deleteConfirm"))) return;
    void saveScenes(scenes.filter((_, position) => position !== index));
  }

  const set = <K extends keyof Scene>(key: K, value: Scene[K]) =>
    editing && setEditing({ ...editing, scene: { ...editing.scene, [key]: value } });

  return (
    <div className="scenes" data-testid="scenes">
      <p className="muted assist-hint">{t("scenes.intro")}</p>
      {error ? <p className="notice" role="alert" data-testid="scenes-error">{error}</p> : null}
      {!editing ? (
        <button type="button" className="btn" disabled={busy || context.busy} onClick={() => setEditing({ index: -1, scene: newScene() })} data-testid="scene-add">{t("scenes.add")}</button>
      ) : null}

      {editing ? (
        <form className="card scene-form" onSubmit={submit} data-testid="scene-form">
          <label className="caps" htmlFor="scene-title">{t("scenes.fields.title")}</label>
          <input id="scene-title" className="field" maxLength={100} value={editing.scene.title} lang={work.language} onChange={(event) => set("title", event.target.value)} data-testid="scene-title" />
          {SCENE_TEXT_FIELDS.map((key) => (
            <div key={key} className="scene-field">
              <label className="caps" htmlFor={`scene-${key}`}>{t(`scenes.fields.${key}`)}</label>
              <textarea id={`scene-${key}`} className="field scene-text" rows={2} maxLength={4000} value={editing.scene[key]} lang={work.language} onChange={(event) => set(key, event.target.value)} data-testid={`scene-${key}`} />
            </div>
          ))}
          {SCENE_LINE_FIELDS.map((key) => (
            <div key={key} className="scene-field">
              <label className="caps" htmlFor={`scene-${key}`}>{t(`scenes.fields.${key}`)}</label>
              <input id={`scene-${key}`} className="field" maxLength={key === "timeLabel" ? 240 : 4000} value={editing.scene[key]} lang={work.language} onChange={(event) => set(key, event.target.value)} data-testid={`scene-${key}`} />
            </div>
          ))}
          <label className="scene-check">
            <input type="checkbox" checked={editing.scene.flashback} onChange={(event) => set("flashback", event.target.checked)} data-testid="scene-flashback" />
            {t("scenes.fields.flashback")}
          </label>
          <div className="scene-field">
            <label className="caps" htmlFor="scene-status">{t("scenes.fields.status")}</label>
            <select id="scene-status" className="field" value={editing.scene.status} onChange={(event) => set("status", event.target.value as Scene["status"])} data-testid="scene-status">
              {STATUSES.map((status) => <option key={status} value={status}>{t(`scenes.status.${status}`)}</option>)}
            </select>
          </div>
          <div className="scene-range">
            <span className="muted">{editing.scene.needsRelocation ? t("scenes.needsPlace") : t("scenes.place")}</span>
            <button type="button" className="btn quiet" onClick={useSelection} data-testid="scene-use-selection">{t("scenes.useSelection")}</button>
          </div>
          <div className="draft-actions">
            <button type="submit" className="btn primary" disabled={busy} data-testid="scene-save">{t("ideate.save")}</button>
            <button type="button" className="btn quiet" onClick={() => setEditing(null)}>{t("ideate.cancel")}</button>
          </div>
        </form>
      ) : null}

      {scenes.length === 0 && !editing ? <p className="muted" data-testid="scenes-empty">{t("scenes.empty")}</p> : null}
      <ol className="scene-list">
        {scenes.map((scene, index) => (
          <li key={scene.id ?? index} className="scene" data-testid="scene-row" data-status={scene.status} data-needs-place={Boolean(scene.needsRelocation)}>
            <div className="scene-head">
              <span className="scene-name" lang={work.language}>{scene.title}</span>
              <span className="caps">{t(`scenes.status.${scene.status}`)}</span>
            </div>
            {scene.goal ? <div className="muted" lang={work.language} data-testid="scene-row-goal">{scene.goal}</div> : null}
            {scene.needsRelocation ? <div className="notice">{t("scenes.needsPlace")}</div> : null}
            <div className="draft-actions">
              <button type="button" className="btn quiet" disabled={busy} onClick={() => setEditing({ index, scene: structuredClone(scene) })} data-testid="scene-edit">{t("scenes.edit")}</button>
              <button type="button" className="btn quiet" disabled={busy || index === 0} onClick={() => move(index, -1)} aria-label={t("scenes.moveUp", { title: scene.title })} data-testid="scene-up">↑</button>
              <button type="button" className="btn quiet" disabled={busy || index === scenes.length - 1} onClick={() => move(index, 1)} aria-label={t("scenes.moveDown", { title: scene.title })} data-testid="scene-down">↓</button>
              <button type="button" className="btn quiet" disabled={busy} onClick={() => remove(index)} data-testid="scene-delete">{t("ideate.delete")}</button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
