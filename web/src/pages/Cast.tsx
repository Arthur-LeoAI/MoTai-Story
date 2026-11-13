import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, errorText, type WorkSummary } from "../api";
import {
  CHARACTER_MAIN_FIELDS, CHARACTER_MORE_FIELDS, castApi, parseAliases,
  type CharacterField, type Entity, type EntityDraft
} from "../castApi";

type Loaded = { state: "loading" } | { state: "ready"; characters: Entity[] } | { state: "failed"; message: string };
type Editing = { mode: "new" } | { mode: "edit"; entity: Entity } | null;

const ALL_FIELDS: readonly CharacterField[] = [...CHARACTER_MAIN_FIELDS, ...CHARACTER_MORE_FIELDS];

/** The first letter of a name, for the medallion (a whole character, not half of a surrogate pair). */
const initial = (name: string) => Array.from(name.trim())[0] ?? "?";

function emptyDraft(): EntityDraft {
  return { name: "", aliases: [], summary: "", card: {}, notes: "" };
}

function draftOf(entity: Entity): EntityDraft {
  const card: Record<string, string> = {};
  for (const key of ALL_FIELDS) card[key] = entity.card[key] ?? "";
  return { name: entity.name, aliases: entity.aliases, summary: entity.summary, card, notes: entity.notes };
}

/** One character on the grid: who they are in a sentence, and what they want and fear. */
function CharacterCard({ entity, language, onOpen }: { entity: Entity; language: string; onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <li>
      <button type="button" className="card cast-card" onClick={onOpen} data-testid="cast-card" data-entity-id={entity.id}>
        <span className="cast-medallion" aria-hidden="true" lang={language}>{initial(entity.name)}</span>
        <span className="cast-card-body">
          <span className="cast-name display" lang={language} data-testid="cast-card-name">{entity.name}</span>
          {entity.summary
            ? <span className="cast-summary" lang={language} data-testid="cast-card-summary">{entity.summary}</span>
            : <span className="cast-summary muted">{t("cast.noSummary")}</span>}
          {(["want", "obstacle"] as const).map((key) => entity.card[key] ? (
            <span key={key} className="cast-line" data-testid={`cast-card-${key}`}>
              <span className="caps">{t(`cast.fields.${key}.short`)}</span>
              <span lang={language}>{entity.card[key]}</span>
            </span>
          ) : null)}
        </span>
      </button>
    </li>
  );
}

/** Create or edit one character card. */
function CharacterDialog({ workId, language, editing, onClose, onSaved, onRemoved, onReload }: {
  workId: string;
  language: string;
  editing: Editing;
  onClose: () => void;
  onSaved: (entity: Entity) => void;
  onRemoved: (entityId: string) => void;
  onReload: () => Promise<Entity | null>;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [draft, setDraft] = useState<EntityDraft>(emptyDraft);
  const [aliases, setAliases] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const entity = editing?.mode === "edit" ? editing.entity : null;

  // A layout effect, so the form is filled before the dialog is first painted.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (editing && !dialog.open) {
      const next = entity ? draftOf(entity) : emptyDraft();
      setDraft(next);
      setAliases(next.aliases.join(", "));
      setError("");
      setConflict(false);
      dialog.showModal();
    } else if (!editing && dialog.open) dialog.close();
  }, [editing, entity]);

  const setCard = (key: CharacterField, value: string) => setDraft((current) => ({ ...current, card: { ...current.card, [key]: value } }));

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft.name.trim()) {
      setError(t("errors.CANON_NAME_REQUIRED"));
      return;
    }
    setBusy(true);
    setError("");
    setConflict(false);
    const payload = { ...draft, name: draft.name.trim(), aliases: parseAliases(aliases) };
    try {
      const { item } = entity
        ? await castApi.update(workId, entity, payload)
        : await castApi.create(workId, "character", payload);
      onSaved(item);
      onClose();
    } catch (cause) {
      setError(errorText(t, cause));
      setConflict(cause instanceof ApiError && cause.code === "REVISION_CONFLICT");
    } finally {
      setBusy(false);
    }
  }

  // After a conflict: show the version saved elsewhere. The writer's own edits
  // are replaced, so this only happens when they ask for it.
  async function loadSaved() {
    setBusy(true);
    try {
      const saved = await onReload();
      if (!saved) {
        onClose();
        return;
      }
      const next = draftOf(saved);
      setDraft(next);
      setAliases(next.aliases.join(", "));
      setError("");
      setConflict(false);
    } catch (cause) {
      setError(errorText(t, cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!entity || !window.confirm(t("cast.deleteConfirm", { name: entity.name }))) return;
    setBusy(true);
    setError("");
    try {
      await castApi.remove(workId, entity);
      onRemoved(entity.id);
      onClose();
    } catch (cause) {
      setError(errorText(t, cause));
      setConflict(cause instanceof ApiError && cause.code === "REVISION_CONFLICT");
    } finally {
      setBusy(false);
    }
  }

  const field = (key: CharacterField, rows = 2) => (
    <div className="cast-field" key={key}>
      <label className="caps" htmlFor={`cast-${key}`}>{t(`cast.fields.${key}.label`)}</label>
      <textarea
        id={`cast-${key}`}
        className="field scene-text"
        rows={rows}
        maxLength={2000}
        lang={language}
        value={draft.card[key] ?? ""}
        placeholder={t(`cast.fields.${key}.hint`)}
        onChange={(event) => setCard(key, event.target.value)}
        data-testid={`cast-field-${key}`}
      />
    </div>
  );

  return (
    <dialog ref={dialogRef} className="dialog cast-dialog" onClose={onClose} aria-labelledby="cast-dialog-title" data-testid="cast-dialog">
      <form onSubmit={save} className="dialog-body" noValidate>
        <h2 id="cast-dialog-title" className="display dialog-title">{entity ? t("cast.editTitle") : t("cast.newTitle")}</h2>

        <label className="caps" htmlFor="cast-name">{t("cast.name")}</label>
        <input id="cast-name" className="field" maxLength={160} required lang={language} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} data-testid="cast-name" />

        <label className="caps" htmlFor="cast-summary">{t("cast.summary")}</label>
        <input id="cast-summary" className="field" maxLength={600} lang={language} value={draft.summary} placeholder={t("cast.summaryHint")} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} data-testid="cast-summary" />

        {CHARACTER_MAIN_FIELDS.map((key) => field(key))}

        <details className="cast-more" data-testid="cast-more">
          <summary className="caps">{t("cast.more")}</summary>
          <div className="cast-more-body">
            <div className="cast-field">
              <label className="caps" htmlFor="cast-aliases">{t("cast.aliases")}</label>
              <input id="cast-aliases" className="field" maxLength={1000} lang={language} value={aliases} placeholder={t("cast.aliasesHint")} onChange={(event) => setAliases(event.target.value)} data-testid="cast-aliases" />
            </div>
            {CHARACTER_MORE_FIELDS.map((key) => field(key))}
            <div className="cast-field">
              <label className="caps" htmlFor="cast-notes">{t("cast.notes")}</label>
              <textarea id="cast-notes" className="field scene-text" rows={4} maxLength={20000} lang={language} value={draft.notes} placeholder={t("cast.notesHint")} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} data-testid="cast-notes" />
            </div>
          </div>
        </details>

        {error ? (
          <div className="notice cast-error" role="alert" data-testid="cast-error">
            <span>{error}</span>
            {conflict ? <button type="button" className="btn" onClick={() => void loadSaved()} disabled={busy} data-testid="cast-load-saved">{t("cast.loadSaved")}</button> : null}
          </div>
        ) : null}

        <div className="dialog-row dialog-actions">
          <button type="submit" className="btn primary" disabled={busy} data-testid="cast-save">{busy ? t("write.saving") : t("ideate.save")}</button>
          <button type="button" className="btn" onClick={onClose} disabled={busy} data-testid="cast-cancel">{t("ideate.cancel")}</button>
          {entity ? <button type="button" className="btn quiet cast-delete" onClick={() => void remove()} disabled={busy} data-testid="cast-delete">{t("cast.delete")}</button> : null}
        </div>
      </form>
    </dialog>
  );
}

/** Cast: the characters of a story as cards (plan 5.5, card view). */
export default function Cast({ work }: { work: WorkSummary }) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [editing, setEditing] = useState<Editing>(null);

  const load = useCallback(async () => {
    const { canon } = await castApi.canon(work.id);
    const characters = canon.entities.filter((entity) => entity.type === "character");
    setLoaded({ state: "ready", characters });
    return characters;
  }, [work.id]);

  useEffect(() => {
    load().catch((cause) => setLoaded({ state: "failed", message: errorText(t, cause) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const characters = loaded.state === "ready" ? loaded.characters : [];
  const earlierNotes = (["characters", "relationships"] as const).filter((key) => work.storyBible?.[key]?.trim());

  function saved(entity: Entity) {
    setLoaded((current) => current.state !== "ready" ? current : {
      state: "ready",
      characters: current.characters.some((item) => item.id === entity.id)
        ? current.characters.map((item) => item.id === entity.id ? entity : item)
        : [...current.characters, entity]
    });
  }

  function removed(entityId: string) {
    setLoaded((current) => current.state !== "ready" ? current : { state: "ready", characters: current.characters.filter((item) => item.id !== entityId) });
  }

  async function reloadEditing(): Promise<Entity | null> {
    const fresh = await load();
    const id = editing?.mode === "edit" ? editing.entity.id : "";
    const entity = fresh.find((item) => item.id === id) ?? null;
    if (entity) setEditing({ mode: "edit", entity });
    return entity;
  }

  return (
    <div className="cast" data-testid="cast">
      <header className="cast-head">
        <div className="caps">{t("cast.part")}</div>
        <h1 className="display page-title">{t("nav.cast")}</h1>
        <p className="page-subtitle muted">{t("cast.subtitle")}</p>
      </header>
      <hr className="rule2" />

      {loaded.state === "loading" ? <p className="muted">{t("app.loading")}</p> : null}
      {loaded.state === "failed" ? <p className="notice" role="alert" data-testid="cast-load-error">{loaded.message}</p> : null}

      {loaded.state === "ready" ? (
        <>
          {characters.length === 0 ? <p className="muted cast-empty" data-testid="cast-empty">{t("cast.empty")}</p> : null}
          <ul className="cast-grid" data-testid="cast-grid" aria-label={t("cast.listLabel")}>
            {characters.map((entity) => (
              <CharacterCard key={entity.id} entity={entity} language={work.language} onOpen={() => setEditing({ mode: "edit", entity })} />
            ))}
            <li>
              <button type="button" className="cast-card cast-new" onClick={() => setEditing({ mode: "new" })} data-testid="cast-new">
                <span className="cast-medallion cast-medallion-new" aria-hidden="true">+</span>
                <span className="cast-card-body">
                  <span className="cast-name display">{t("cast.new")}</span>
                  <span className="cast-summary muted">{t("cast.newHint")}</span>
                </span>
              </button>
            </li>
          </ul>
        </>
      ) : null}

      {earlierNotes.length ? (
        <details className="cast-earlier" data-testid="cast-earlier">
          <summary className="caps">{t("cast.earlierNotes")}</summary>
          <p className="muted assist-hint">{t("cast.earlierNotesHint")}</p>
          {earlierNotes.map((key) => (
            <div key={key} className="cast-earlier-field">
              <div className="caps">{t(`artifact.fields.${key}`)}</div>
              <p className="cast-earlier-text" lang={work.language}>{work.storyBible[key]}</p>
            </div>
          ))}
        </details>
      ) : null}

      <CharacterDialog
        workId={work.id}
        language={work.language}
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={saved}
        onRemoved={removed}
        onReload={reloadEditing}
      />
    </div>
  );
}
