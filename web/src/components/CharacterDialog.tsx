import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, errorText } from "../api";
import {
  CHARACTER_MAIN_FIELDS, CHARACTER_MORE_FIELDS, castApi, parseAliases,
  type CharacterField, type Entity, type EntityDraft
} from "../castApi";

/** What the character dialog is showing: a new card (perhaps an AI draft to check), or a saved one. */
export type CharacterEditing = { mode: "new"; draft?: EntityDraft } | { mode: "edit"; entity: Entity } | null;
type Editing = CharacterEditing;

const ALL_FIELDS: readonly CharacterField[] = [...CHARACTER_MAIN_FIELDS, ...CHARACTER_MORE_FIELDS];

function emptyDraft(): EntityDraft {
  return { name: "", aliases: [], summary: "", card: {}, notes: "" };
}

function draftOf(entity: Entity): EntityDraft {
  const card: Record<string, string> = {};
  for (const key of ALL_FIELDS) card[key] = entity.card[key] ?? "";
  return { name: entity.name, aliases: entity.aliases, summary: entity.summary, card, notes: entity.notes };
}

/** Create or edit one character card. */
export function CharacterDialog({ workId, language, editing, onClose, onSaved, onRemoved, onReload }: {
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
  const isDraft = editing?.mode === "new" && Boolean(editing.draft);

  // A layout effect, so the form is filled before the dialog is first painted.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (editing && !dialog.open) {
      const next = entity ? draftOf(entity) : editing.mode === "new" && editing.draft ? { ...emptyDraft(), ...editing.draft, card: { ...editing.draft.card } } : emptyDraft();
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
        <h2 id="cast-dialog-title" className="display dialog-title">{entity ? t("cast.editTitle") : isDraft ? t("cast.draftTitle") : t("cast.newTitle")}</h2>
        {isDraft ? <p className="muted assist-hint" data-testid="cast-draft-note">{t("cast.draftNote")}</p> : null}

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

