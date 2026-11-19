import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, errorText } from "../api";
import { castApi, type Entity, type EntityDraft, type Relation } from "../castApi";

// Places and factions on the World page (plan 5.6).
// - Places are cards in a simple hierarchy (region › city › place): a place
//   may sit inside another place (`parentId`), shown by indenting.
// - Factions are cards (what they want, hold and fear) with a stance matrix:
//   each pair of factions is allied, neutral or hostile. A stance is a
//   relation of kind "ally" or "enemy"; neutral is no such relation.

type Kind = "location" | "faction";
type Editing = { mode: "new"; parentId?: string } | { mode: "edit"; entity: Entity } | null;
type Field = { key: string; card: boolean; rows: number; limit: number };

const FIELDS: Record<Kind, Field[]> = {
  location: [
    { key: "summary", card: false, rows: 2, limit: 600 },
    { key: "atmosphere", card: true, rows: 2, limit: 2000 },
    { key: "occupants", card: true, rows: 2, limit: 2000 }
  ],
  faction: [
    { key: "summary", card: false, rows: 2, limit: 600 },
    { key: "want", card: true, rows: 2, limit: 2000 },
    { key: "assets", card: true, rows: 2, limit: 2000 },
    { key: "fear", card: true, rows: 2, limit: 2000 }
  ]
};

/** Ids of a place and every place inside it, however deep. */
function withDescendants(places: Entity[], id: string): Set<string> {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const place of places) {
      if (place.parentId && ids.has(place.parentId) && !ids.has(place.id)) {
        ids.add(place.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** Places in tree order, each with its depth; a place whose parent is gone sits at the top. */
function placeTree(places: Entity[]): Array<{ place: Entity; depth: number }> {
  const ids = new Set(places.map((place) => place.id));
  const children = new Map<string, Entity[]>();
  for (const place of places) {
    const parent = place.parentId && ids.has(place.parentId) ? place.parentId : "";
    children.set(parent, [...(children.get(parent) ?? []), place]);
  }
  const rows: Array<{ place: Entity; depth: number }> = [];
  const visit = (parent: string, depth: number) => {
    for (const place of children.get(parent) ?? []) {
      rows.push({ place, depth });
      visit(place.id, depth + 1);
    }
  };
  visit("", 0);
  return rows;
}

function CardDialog({ workId, language, kind, editing, places, onClose, onChanged, onReload }: {
  workId: string;
  language: string;
  kind: Kind;
  editing: Editing;
  places: Entity[];
  onClose: () => void;
  onChanged: () => void;
  onReload: () => Promise<Entity | null>;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const entity = editing?.mode === "edit" ? editing.entity : null;
  const prefix = `world.${kind === "location" ? "places" : "factions"}`;
  const fill = (value: Entity | null, parentId = "") => {
    const next: Record<string, string> = { name: value?.name ?? "", parentId: value?.parentId ?? parentId };
    for (const field of FIELDS[kind]) next[field.key] = field.card ? (value?.card[field.key] ?? "") : (value?.summary ?? "");
    setValues(next);
  };

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (editing && !dialog.open) {
      fill(entity, editing.mode === "new" ? editing.parentId : "");
      setError("");
      setConflict(false);
      dialog.showModal();
    } else if (!editing && dialog.open) dialog.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, entity]);

  async function save(submit: FormEvent) {
    submit.preventDefault();
    if (!values.name?.trim()) {
      setError(t("errors.CANON_NAME_REQUIRED"));
      return;
    }
    const card: Record<string, string> = {};
    for (const field of FIELDS[kind]) if (field.card) card[field.key] = (values[field.key] ?? "").trim();
    const payload: EntityDraft = {
      name: values.name.trim(),
      aliases: entity?.aliases ?? [],
      summary: (values.summary ?? "").trim(),
      card,
      notes: entity?.notes ?? "",
      ...(kind === "location" ? { parentId: values.parentId ?? "" } : {})
    };
    setBusy(true);
    setError("");
    setConflict(false);
    try {
      if (entity) await castApi.update(workId, entity, payload);
      else await castApi.create(workId, kind, payload);
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
    if (!entity || !window.confirm(t(`${prefix}.deleteConfirm`))) return;
    setBusy(true);
    try {
      await castApi.remove(workId, entity);
      onChanged();
      onClose();
    } catch (cause) {
      setError(errorText(t, cause));
      setConflict(cause instanceof ApiError && cause.code === "REVISION_CONFLICT");
    } finally {
      setBusy(false);
    }
  }

  // A place cannot sit inside itself or inside a place within it.
  const blocked = entity ? withDescendants(places, entity.id) : new Set<string>();
  const parents = placeTree(places).filter(({ place }) => !blocked.has(place.id));
  const testId = kind === "location" ? "place" : "faction";

  return (
    <dialog ref={dialogRef} className="dialog cast-dialog" onClose={onClose} aria-labelledby={`${testId}-dialog-title`} data-testid={`${testId}-dialog`}>
      <form onSubmit={save} className="dialog-body" noValidate>
        <h2 id={`${testId}-dialog-title`} className="display dialog-title">{entity ? t(`${prefix}.editTitle`) : t(`${prefix}.newTitle`)}</h2>
        <div className="dialog-field">
          <label className="caps" htmlFor={`${testId}-name`}>{t(`${prefix}.fields.name`)}</label>
          <input id={`${testId}-name`} className="field" maxLength={160} lang={language} value={values.name ?? ""} placeholder={t(`${prefix}.hints.name`)} onChange={(change) => setValues({ ...values, name: change.target.value })} data-testid={`${testId}-name`} />
        </div>
        {kind === "location" ? (
          <div className="dialog-field">
            <label className="caps" htmlFor="place-parent">{t("world.places.fields.parent")}</label>
            <select id="place-parent" className="field" value={values.parentId ?? ""} onChange={(change) => setValues({ ...values, parentId: change.target.value })} data-testid="place-parent">
              <option value="">{t("world.places.noParent")}</option>
              {parents.map(({ place, depth }) => (
                <option key={place.id} value={place.id} lang={language}>{"  ".repeat(depth)}{place.name}</option>
              ))}
            </select>
          </div>
        ) : null}
        {FIELDS[kind].map((field) => (
          <div key={field.key} className="dialog-field">
            <label className="caps" htmlFor={`${testId}-${field.key}`}>{t(`${prefix}.fields.${field.key}`)}</label>
            <textarea id={`${testId}-${field.key}`} className="field" rows={field.rows} maxLength={field.limit} lang={language} value={values[field.key] ?? ""} placeholder={t(`${prefix}.hints.${field.key}`)} onChange={(change) => setValues({ ...values, [field.key]: change.target.value })} data-testid={`${testId}-${field.key}`} />
          </div>
        ))}
        {error ? (
          <div className="notice cast-error" role="alert" data-testid={`${testId}-error`}>
            <span>{error}</span>
            {conflict ? <button type="button" className="btn" onClick={() => void loadSaved()} disabled={busy}>{t("cast.loadSaved")}</button> : null}
          </div>
        ) : null}
        <div className="dialog-row dialog-actions">
          <button type="submit" className="btn primary" disabled={busy} data-testid={`${testId}-save`}>{busy ? t("write.saving") : t("ideate.save")}</button>
          <button type="button" className="btn" onClick={onClose} disabled={busy} data-testid={`${testId}-cancel`}>{t("ideate.cancel")}</button>
          {entity ? <button type="button" className="btn quiet cast-delete" onClick={() => void remove()} disabled={busy} data-testid={`${testId}-delete`}>{t(`${prefix}.delete`)}</button> : null}
        </div>
      </form>
    </dialog>
  );
}

/** The open dialog, and "load the saved version" for a change saved elsewhere. */
function useEditing(onReload: () => Promise<Entity[]>, cards: Entity[], openId: string) {
  const [editing, setEditing] = useState<Editing>(null);
  // A card asked for by the address opens once it is here.
  useEffect(() => {
    const entity = openId ? cards.find((candidate) => candidate.id === openId) : undefined;
    if (entity) setEditing({ mode: "edit", entity });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);
  const reload = async () => {
    const fresh = await onReload();
    const id = editing?.mode === "edit" ? editing.entity.id : "";
    const entity = fresh.find((candidate) => candidate.id === id) ?? null;
    if (entity) setEditing({ mode: "edit", entity });
    return entity;
  };
  return { editing, setEditing, reload };
}

export function PlacesSection({ workId, language, openId, places, onChanged, onReload }: {
  workId: string;
  language: string;
  openId: string;
  places: Entity[];
  onChanged: () => void;
  onReload: () => Promise<Entity[]>;
}) {
  const { t } = useTranslation();
  const { editing, setEditing, reload } = useEditing(onReload, places, openId);
  const rows = placeTree(places);
  return (
    <section className="world-section" aria-labelledby="places-title" data-testid="places">
      <div className="spine-head">
        <div>
          <h2 id="places-title" className="caps spine-title">{t("world.places.title")}</h2>
          <p className="muted assist-hint">{t("world.places.hint")}</p>
        </div>
        <button type="button" className="btn" onClick={() => setEditing({ mode: "new" })} data-testid="place-new">{t("world.places.new")}</button>
      </div>
      {rows.length === 0 ? <p className="muted cast-empty" data-testid="places-empty">{t("world.places.empty")}</p> : (
        <ul className="place-tree">
          {rows.map(({ place, depth }) => (
            <li key={place.id} className="place-row" style={{ ["--depth" as string]: depth }} data-testid="place-row" data-place-id={place.id} data-depth={depth}>
              <button type="button" className="place-open" onClick={() => setEditing({ mode: "edit", entity: place })} data-testid="place-open">
                <strong lang={language}>{place.name}</strong>
                {place.summary ? <span className="muted" lang={language}>{place.summary}</span> : null}
              </button>
              <button type="button" className="btn quiet place-add-inside" onClick={() => setEditing({ mode: "new", parentId: place.id })} aria-label={t("world.places.addInsideLabel", { name: place.name })} data-testid="place-add-inside">{t("world.places.addInside")}</button>
            </li>
          ))}
        </ul>
      )}
      <CardDialog workId={workId} language={language} kind="location" editing={editing} places={places} onClose={() => setEditing(null)} onChanged={onChanged} onReload={reload} />
    </section>
  );
}

const STANCES = ["neutral", "ally", "enemy"] as const;
type Stance = (typeof STANCES)[number];

/** The stance relation between two factions, in either direction. */
function stanceBetween(relations: Relation[], a: string, b: string): Relation | null {
  return relations.find((relation) => (relation.kind === "ally" || relation.kind === "enemy") && ((relation.fromId === a && relation.toId === b) || (relation.fromId === b && relation.toId === a))) ?? null;
}

export function FactionsSection({ workId, language, openId, factions, relations, onChanged, onReload }: {
  workId: string;
  language: string;
  openId: string;
  factions: Entity[];
  relations: Relation[];
  onChanged: () => void;
  onReload: () => Promise<Entity[]>;
}) {
  const { t } = useTranslation();
  const { editing, setEditing, reload } = useEditing(onReload, factions, openId);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  // Neutral → allies → enemies → neutral.
  async function cycle(a: Entity, b: Entity) {
    const relation = stanceBetween(relations, a.id, b.id);
    const current: Stance = relation ? (relation.kind as Stance) : "neutral";
    const next = STANCES[(STANCES.indexOf(current) + 1) % STANCES.length];
    setBusy(`${a.id}:${b.id}`);
    setError("");
    try {
      if (next === "neutral" && relation) await castApi.removeRelation(workId, relation);
      else if (relation) await castApi.updateRelation(workId, relation, { fromId: relation.fromId, toId: relation.toId, kind: next as "ally" | "enemy", label: relation.label, tension: relation.tension });
      else await castApi.createRelation(workId, { fromId: a.id, toId: b.id, kind: next as "ally" | "enemy", label: "", tension: "" });
      onChanged();
    } catch (cause) {
      setError(errorText(t, cause));
      if (cause instanceof ApiError && cause.code === "REVISION_CONFLICT") onChanged();
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="world-section" aria-labelledby="factions-title" data-testid="factions">
      <div className="spine-head">
        <div>
          <h2 id="factions-title" className="caps spine-title">{t("world.factions.title")}</h2>
          <p className="muted assist-hint">{t("world.factions.hint")}</p>
        </div>
        <button type="button" className="btn" onClick={() => setEditing({ mode: "new" })} data-testid="faction-new">{t("world.factions.new")}</button>
      </div>
      {factions.length === 0 ? <p className="muted cast-empty" data-testid="factions-empty">{t("world.factions.empty")}</p> : (
        <ul className="rule-cards">
          {factions.map((faction) => (
            <li key={faction.id}>
              <button type="button" className="card rule-card" onClick={() => setEditing({ mode: "edit", entity: faction })} data-testid="faction-card" data-faction-id={faction.id}>
                <strong lang={language}>{faction.name}</strong>
                {faction.summary ? <span className="muted" lang={language}>{faction.summary}</span> : null}
                {(["want", "assets", "fear"] as const).map((key) => (
                  <span key={key} className="rule-row">
                    <span className="caps">{t(`world.factions.short.${key}`)}</span>
                    {faction.card[key] ? <span lang={language}>{faction.card[key]}</span> : <span className="muted rule-missing">{t("world.factions.unknown")}</span>}
                  </span>
                ))}
              </button>
            </li>
          ))}
        </ul>
      )}
      {factions.length >= 2 ? (
        <div className="stance-wrap">
          <table className="stance" data-testid="stance-matrix">
            <caption className="caps">{t("world.factions.matrix")}</caption>
            <thead>
              <tr>
                <td />
                {factions.map((faction) => <th key={faction.id} scope="col" lang={language}>{faction.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {factions.map((row) => (
                <tr key={row.id}>
                  <th scope="row" lang={language}>{row.name}</th>
                  {factions.map((column) => {
                    if (row.id === column.id) return <td key={column.id} className="stance-self" aria-hidden="true">—</td>;
                    const relation = stanceBetween(relations, row.id, column.id);
                    const stance: Stance = relation ? (relation.kind as Stance) : "neutral";
                    const label = t("world.factions.cellLabel", { a: row.name, b: column.name, stance: t(`world.factions.stances.${stance}`) });
                    return (
                      <td key={column.id}>
                        <button type="button" className={`stance-cell ${stance}`} onClick={() => void cycle(row, column)} disabled={Boolean(busy)} aria-label={label} title={label} data-testid="stance-cell" data-a={row.id} data-b={column.id} data-stance={stance}>
                          {t(`world.factions.stances.${stance}`)}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted assist-hint">{t("world.factions.matrixHint")}</p>
        </div>
      ) : null}
      {error ? <p className="notice" role="alert" data-testid="stance-error">{error}</p> : null}
      <CardDialog workId={workId} language={language} kind="faction" editing={editing} places={[]} onClose={() => setEditing(null)} onChanged={onChanged} onReload={reload} />
    </section>
  );
}
