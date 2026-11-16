import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, errorText, type WorkSummary } from "../api";
import {
  CHARACTER_MAIN_FIELDS, CHARACTER_MORE_FIELDS, castApi, parseAliases,
  type CharacterField, type Entity, type EntityDraft, type Relation
} from "../castApi";
import { RelationDialog, RelationsMap, initial, relationText, type RelationEditing } from "../components/RelationsMap";

type Loaded = { state: "loading" } | { state: "ready"; characters: Entity[]; relations: Relation[] } | { state: "failed"; message: string };
type Editing = { mode: "new" } | { mode: "edit"; entity: Entity } | null;

const ALL_FIELDS: readonly CharacterField[] = [...CHARACTER_MAIN_FIELDS, ...CHARACTER_MORE_FIELDS];

function emptyDraft(): EntityDraft {
  return { name: "", aliases: [], summary: "", card: {}, notes: "" };
}

function draftOf(entity: Entity): EntityDraft {
  const card: Record<string, string> = {};
  for (const key of ALL_FIELDS) card[key] = entity.card[key] ?? "";
  return { name: entity.name, aliases: entity.aliases, summary: entity.summary, card, notes: entity.notes };
}

/** One character on the grid: who they are in a sentence, and what they want and fear. */
function CharacterCard({ entity, language, selected, onSelect }: { entity: Entity; language: string; selected: boolean; onSelect: () => void }) {
  const { t } = useTranslation();
  return (
    <li>
      <button type="button" className={selected ? "card cast-card on" : "card cast-card"} aria-pressed={selected} onClick={onSelect} data-testid="cast-card" data-entity-id={entity.id}>
        <span className="medal cast-medallion" aria-hidden="true" lang={language}>{initial(entity.name)}</span>
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

const VIEW_KEY = "novel-studio:cast-view";
type View = "relations" | "portraits";

function storedView(): View {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "portraits" ? "portraits" : "relations";
  } catch {
    return "relations";
  }
}

/** The selected character beside the map: the three questions, and their relationships. */
function CharacterPanel({ entity, characters, relations, language, onEdit, onOpenRelation, onAddRelation }: {
  entity: Entity;
  characters: Entity[];
  relations: Relation[];
  language: string;
  onEdit: () => void;
  onOpenRelation: (relation: Relation) => void;
  onAddRelation: (toId: string) => void;
}) {
  const { t } = useTranslation();
  const [target, setTarget] = useState("");
  const others = characters.filter((item) => item.id !== entity.id);
  const nameOf = (id: string) => characters.find((item) => item.id === id)?.name ?? "";
  const own = relations.filter((relation) => relation.fromId === entity.id || relation.toId === entity.id);

  return (
    <aside className="cast-panel" aria-label={t("cast.panel.label")} data-testid="cast-panel" data-entity-id={entity.id}>
      <div className="card cast-panel-card">
        <div className="cast-panel-head">
          <div className="medal cast-panel-medal" aria-hidden="true" lang={language}>{initial(entity.name)}</div>
          <div className="cast-card-body">
            <h2 className="display cast-panel-name" lang={language} data-testid="cast-panel-name">{entity.name}</h2>
            {entity.summary ? <div className="cast-summary muted" lang={language}>{entity.summary}</div> : null}
          </div>
        </div>
        <hr className="rule" />
        {(["want", "obstacle", "change"] as const).map((key) => (
          <div key={key} data-testid={`cast-panel-${key}`}>
            <div className="caps">{t(`cast.panel.${key}`)}</div>
            {entity.card[key] ? <div lang={language}>{entity.card[key]}</div> : <div className="muted cast-unset">{t("cast.panel.unset")}</div>}
          </div>
        ))}
        <div className="dialog-row">
          <button type="button" className="btn" onClick={onEdit} data-testid="cast-edit">{t("cast.panel.edit")}</button>
        </div>
      </div>

      <div className="card cast-panel-card">
        <div className="caps">{t("cast.relation.heading")}</div>
        {own.length ? (
          <ul className="cast-relations" data-testid="cast-relations">
            {own.map((relation) => (
              <li key={relation.id}>
                <button type="button" className="btn quiet cast-relation" onClick={() => onOpenRelation(relation)} data-testid="cast-relation" data-relation-id={relation.id}>
                  <span lang={language}>{nameOf(relation.fromId)} {relation.kind === "mentor" ? "→" : "—"} {nameOf(relation.toId)}</span>
                  <span className="muted">{relationText(t, relation)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="muted cast-unset">{t("cast.relation.none")}</p>}
        {others.length ? (
          <div className="cast-relation-add">
            <label className="visually-hidden" htmlFor="relation-target">{t("cast.relation.linkTo", { name: entity.name })}</label>
            <select id="relation-target" className="field" value={target} onChange={(event) => setTarget(event.target.value)} data-testid="relation-add-target">
              <option value="">{t("cast.relation.linkTo", { name: entity.name })}</option>
              {others.map((item) => <option key={item.id} value={item.id} lang={language}>{item.name}</option>)}
            </select>
            <button type="button" className="btn" disabled={!target} onClick={() => { onAddRelation(target); setTarget(""); }} data-testid="relation-add">{t("cast.relation.add")}</button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

/** Cast: who the characters are, and what lies between them (plan 5.5). */
export default function Cast({ work }: { work: WorkSummary }) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [editing, setEditing] = useState<Editing>(null);
  const [relationEditing, setRelationEditing] = useState<RelationEditing>(null);
  const [selectedId, setSelectedId] = useState("");
  const [view, setView] = useState<View>(storedView);

  const load = useCallback(async () => {
    const { canon } = await castApi.canon(work.id);
    const characters = canon.entities.filter((entity) => entity.type === "character");
    const ids = new Set(characters.map((entity) => entity.id));
    const relations = (canon.relations ?? []).filter((relation) => ids.has(relation.fromId) && ids.has(relation.toId));
    setLoaded({ state: "ready", characters, relations });
    return { characters, relations };
  }, [work.id]);

  useEffect(() => {
    load().catch((cause) => setLoaded({ state: "failed", message: errorText(t, cause) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const characters = loaded.state === "ready" ? loaded.characters : [];
  const relations = loaded.state === "ready" ? loaded.relations : [];
  const selected = characters.find((entity) => entity.id === selectedId) ?? characters[0] ?? null;
  const earlierNotes = (["characters", "relationships"] as const).filter((key) => work.storyBible?.[key]?.trim());

  function chooseView(next: View) {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Remembering the view is a convenience only.
    }
  }

  function saved(entity: Entity) {
    setLoaded((current) => current.state !== "ready" ? current : {
      ...current,
      characters: current.characters.some((item) => item.id === entity.id)
        ? current.characters.map((item) => item.id === entity.id ? entity : item)
        : [...current.characters, entity]
    });
    setSelectedId(entity.id);
  }

  function relationSaved(relation: Relation) {
    setLoaded((current) => current.state !== "ready" ? current : {
      ...current,
      relations: current.relations.some((item) => item.id === relation.id)
        ? current.relations.map((item) => item.id === relation.id ? relation : item)
        : [...current.relations, relation]
    });
  }

  function relationRemoved(relationId: string) {
    setLoaded((current) => current.state !== "ready" ? current : { ...current, relations: current.relations.filter((item) => item.id !== relationId) });
  }

  async function reloadEditing(): Promise<Entity | null> {
    const fresh = await load();
    const id = editing?.mode === "edit" ? editing.entity.id : "";
    const entity = fresh.characters.find((item) => item.id === id) ?? null;
    if (entity) setEditing({ mode: "edit", entity });
    return entity;
  }

  async function reloadRelation(): Promise<Relation | null> {
    const fresh = await load();
    const id = relationEditing?.mode === "edit" ? relationEditing.relation.id : "";
    const relation = fresh.relations.find((item) => item.id === id) ?? null;
    if (relation) setRelationEditing({ mode: "edit", relation });
    return relation;
  }

  return (
    <div className="cast" data-testid="cast" data-view={view}>
      <header className="cast-head">
        <div>
          <div className="caps">{t("cast.part")}</div>
          <h1 className="display page-title">{t("nav.cast")}</h1>
          <p className="page-subtitle muted">{t("cast.subtitle")}</p>
        </div>
        <div className="cast-actions">
          <div className="cast-views" role="group" aria-label={t("cast.views.label")}>
            {(["portraits", "relations"] as const).map((item) => (
              <button key={item} type="button" className={view === item ? "btn on" : "btn"} aria-pressed={view === item} onClick={() => chooseView(item)} data-testid={`cast-view-${item}`}>
                {t(`cast.views.${item}`)}
              </button>
            ))}
          </div>
          <button type="button" className="btn primary" onClick={() => setEditing({ mode: "new" })} data-testid="cast-new">{t("cast.new")}</button>
        </div>
      </header>
      <hr className="rule2" />

      {loaded.state === "loading" ? <p className="muted">{t("app.loading")}</p> : null}
      {loaded.state === "failed" ? <p className="notice" role="alert" data-testid="cast-load-error">{loaded.message}</p> : null}

      {loaded.state === "ready" && characters.length === 0 ? <p className="muted cast-empty" data-testid="cast-empty">{t("cast.empty")}</p> : null}

      {loaded.state === "ready" && selected ? (
        <div className="cast-body">
          <section className="cast-main" aria-label={view === "relations" ? t("cast.map.label") : t("cast.listLabel")}>
            {view === "relations" ? (
              <RelationsMap
                characters={characters}
                relations={relations}
                selectedId={selected.id}
                language={work.language}
                onSelect={setSelectedId}
                onOpenRelation={(relation) => setRelationEditing({ mode: "edit", relation })}
                onConnect={(fromId, toId) => setRelationEditing({ mode: "new", fromId, toId })}
              />
            ) : (
              <ul className="cast-grid" data-testid="cast-grid">
                {characters.map((entity) => (
                  <CharacterCard key={entity.id} entity={entity} language={work.language} selected={entity.id === selected.id} onSelect={() => setSelectedId(entity.id)} />
                ))}
              </ul>
            )}
          </section>
          <CharacterPanel
            key={selected.id}
            entity={selected}
            characters={characters}
            relations={relations}
            language={work.language}
            onEdit={() => setEditing({ mode: "edit", entity: selected })}
            onOpenRelation={(relation) => setRelationEditing({ mode: "edit", relation })}
            onAddRelation={(toId) => setRelationEditing({ mode: "new", fromId: selected.id, toId })}
          />
        </div>
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
        onRemoved={() => void load()}
        onReload={reloadEditing}
      />
      <RelationDialog
        workId={work.id}
        language={work.language}
        characters={characters}
        editing={relationEditing}
        onClose={() => setRelationEditing(null)}
        onSaved={relationSaved}
        onRemoved={relationRemoved}
        onReload={reloadRelation}
      />
    </div>
  );
}
