import { useLayoutEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, errorText } from "../api";
import { RELATION_KINDS, castApi, type Entity, type Relation, type RelationDraft, type RelationKind } from "../castApi";

// The relationship graph of the Cast page (plan 5.5, mockup project/Cast.dc.html):
// portraits on an oval, a line for each relationship, and a line drawn by
// dragging from one portrait to another. Every action also has a keyboard
// path: portraits are buttons, labels open the relationship, and the side
// panel can add a relationship without dragging.

const WIDTH = 720;
const HEIGHT = 560;
const DRAG_THRESHOLD = 6;

/** The first letter of a name (a whole character, not half of a surrogate pair). */
export const initial = (name: string) => Array.from(name.trim())[0] ?? "?";

type Point = { x: number; y: number };

/** Portraits evenly spaced on an oval; one portrait sits in the middle, two face each other. */
export function layout(count: number): Point[] {
  if (count === 1) return [{ x: WIDTH / 2, y: HEIGHT / 2 }];
  const radiusX = WIDTH / 2 - 100;
  const radiusY = HEIGHT / 2 - 90;
  const start = count === 2 ? Math.PI : -Math.PI / 2;
  return Array.from({ length: count }, (_, index) => {
    const angle = start + (index * 2 * Math.PI) / count;
    return { x: WIDTH / 2 + radiusX * Math.cos(angle), y: HEIGHT / 2 - 10 + radiusY * Math.sin(angle) };
  });
}

const percent = (value: number, total: number) => `${(value / total) * 100}%`;

/** The words for a relationship: the writer's own label, or the kind. */
export function relationText(t: (key: string) => string, relation: Pick<Relation, "kind" | "label">): string {
  if (relation.label.trim()) return relation.label.trim();
  return t(`cast.relation.kinds.${relation.kind}`);
}

export function RelationsMap({ characters, relations, selectedId, language, onSelect, onOpenRelation, onConnect }: {
  characters: Entity[];
  relations: Relation[];
  selectedId: string;
  language: string;
  onSelect: (id: string) => void;
  onOpenRelation: (relation: Relation) => void;
  onConnect: (fromId: string, toId: string) => void;
}) {
  const { t } = useTranslation();
  const areaRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ fromId: string; pointerId: number; start: Point; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [drawing, setDrawing] = useState<{ fromId: string; to: Point } | null>(null);

  const points = layout(characters.length);
  const position = new Map(characters.map((entity, index) => [entity.id, points[index]]));
  const names = new Map(characters.map((entity) => [entity.id, entity.name]));

  // Several relationships between the same two people are drawn as curves
  // that bend apart, so each keeps its own label.
  const pairs = new Map<string, Relation[]>();
  for (const relation of relations) {
    if (!position.has(relation.fromId) || !position.has(relation.toId)) continue;
    const key = [relation.fromId, relation.toId].sort().join("|");
    pairs.set(key, [...(pairs.get(key) ?? []), relation]);
  }
  const lines = [...pairs.values()].flatMap((group) => group.map((relation, index) => {
    const a = position.get(relation.fromId)!;
    const b = position.get(relation.toId)!;
    // Bend relative to a fixed direction of the pair, whichever way each relation points.
    const [p, q] = relation.fromId < relation.toId ? [a, b] : [b, a];
    const dx = q.x - p.x, dy = q.y - p.y;
    const length = Math.hypot(dx, dy) || 1;
    const offset = (index - (group.length - 1) / 2) * 96;
    const mid = { x: (p.x + q.x) / 2 - (dy / length) * offset, y: (p.y + q.y) / 2 + (dx / length) * offset };
    // The label sits on the curve, halfway between the control point and the chord.
    const labelAt = { x: ((p.x + q.x) / 2 + mid.x) / 2, y: ((p.y + q.y) / 2 + mid.y) / 2 };
    return { relation, path: `M ${a.x} ${a.y} Q ${mid.x} ${mid.y} ${b.x} ${b.y}`, labelAt };
  }));

  function toMap(event: { clientX: number; clientY: number }): Point {
    const box = areaRef.current!.getBoundingClientRect();
    return { x: ((event.clientX - box.left) / box.width) * WIDTH, y: ((event.clientY - box.top) / box.height) * HEIGHT };
  }

  function pointerDown(event: ReactPointerEvent<HTMLButtonElement>, fromId: string) {
    if (event.button !== 0) return;
    dragRef.current = { fromId, pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.start.x, event.clientY - drag.start.y) < DRAG_THRESHOLD) return;
    drag.moved = true;
    setDrawing({ fromId: drag.fromId, to: toMap(event) });
  }

  function pointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDrawing(null);
    if (!drag.moved) return;
    suppressClick.current = true;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-node-id]");
    const toId = target?.dataset.nodeId;
    if (toId && toId !== drag.fromId) onConnect(drag.fromId, toId);
  }

  function pointerCancel() {
    dragRef.current = null;
    setDrawing(null);
  }

  const from = drawing ? position.get(drawing.fromId) : undefined;

  return (
    <div className="card relmap" data-testid="relations-map">
      {/* Beside the figure on wide screens, above it on narrow ones (see app.css). */}
      <div className="relmap-caption">
        <div className="caps">{t("cast.map.figure")}</div>
        <p className="muted">{characters.length > 1 ? t("cast.map.hint") : t("cast.map.needsTwo")}</p>
      </div>
      <div className="relmap-area" ref={areaRef}>
        <svg className="relmap-lines" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true">
          {lines.map(({ relation, path }) => {
            const touches = relation.fromId === selectedId || relation.toId === selectedId;
            return <path key={relation.id} d={path} className={touches ? "relmap-line on" : "relmap-line"} />;
          })}
          {from && drawing ? <path d={`M ${from.x} ${from.y} L ${drawing.to.x} ${drawing.to.y}`} className="relmap-line drawing" data-testid="relations-drawing" /> : null}
        </svg>

        {lines.map(({ relation, labelAt }) => (
          <button
            key={relation.id}
            type="button"
            className={relation.fromId === selectedId || relation.toId === selectedId ? "relmap-label on" : "relmap-label"}
            style={{ left: percent(labelAt.x, WIDTH), top: percent(labelAt.y, HEIGHT) }}
            lang={relation.label.trim() ? language : undefined}
            aria-label={t("cast.relation.lineLabel", { from: names.get(relation.fromId), to: names.get(relation.toId), kind: relationText(t, relation) })}
            onClick={() => onOpenRelation(relation)}
            data-testid="relation-label"
            data-relation-id={relation.id}
          >
            {relationText(t, relation)}
          </button>
        ))}

        {characters.map((entity, index) => {
          const point = points[index];
          return (
            <div key={entity.id} className="relmap-node" style={{ left: percent(point.x, WIDTH), top: percent(point.y, HEIGHT) }}>
              <button
                type="button"
                className={entity.id === selectedId ? "medal relmap-medal on" : "medal relmap-medal"}
                aria-label={t("cast.map.nodeLabel", { name: entity.name })}
                aria-pressed={entity.id === selectedId}
                onPointerDown={(event) => pointerDown(event, entity.id)}
                onPointerMove={pointerMove}
                onPointerUp={pointerUp}
                onPointerCancel={pointerCancel}
                onClick={() => {
                  if (suppressClick.current) {
                    suppressClick.current = false;
                    return;
                  }
                  onSelect(entity.id);
                }}
                data-node-id={entity.id}
                data-testid="relations-node"
                lang={language}
              >
                {initial(entity.name)}
              </button>
              <span className="relmap-name" lang={language}>{entity.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export type RelationEditing = { mode: "new"; fromId: string; toId: string } | { mode: "edit"; relation: Relation } | null;

/** Create or edit one relationship: who, which way, what kind, and the tension between them. */
export function RelationDialog({ workId, language, characters, editing, onClose, onSaved, onRemoved, onReload }: {
  workId: string;
  language: string;
  characters: Entity[];
  editing: RelationEditing;
  onClose: () => void;
  onSaved: (relation: Relation) => void;
  onRemoved: (relationId: string) => void;
  onReload: () => Promise<Relation | null>;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [draft, setDraft] = useState<RelationDraft>({ fromId: "", toId: "", kind: "friend", label: "", tension: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const relation = editing?.mode === "edit" ? editing.relation : null;
  const nameOf = (id: string) => characters.find((entity) => entity.id === id)?.name ?? "";

  const fill = (value: Relation) => setDraft({ fromId: value.fromId, toId: value.toId, kind: value.kind, label: value.label, tension: value.tension });

  // A layout effect, so the form is filled before the dialog is first painted.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (editing && !dialog.open) {
      if (editing.mode === "edit") fill(editing.relation);
      else setDraft({ fromId: editing.fromId, toId: editing.toId, kind: "friend", label: "", tension: "" });
      setError("");
      setConflict(false);
      dialog.showModal();
    } else if (!editing && dialog.open) dialog.close();
  }, [editing]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setConflict(false);
    const payload = { ...draft, label: draft.label.trim(), tension: draft.tension.trim() };
    try {
      const { item } = relation ? await castApi.updateRelation(workId, relation, payload) : await castApi.createRelation(workId, payload);
      onSaved(item);
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
    if (!relation || !window.confirm(t("cast.relation.deleteConfirm", { from: nameOf(relation.fromId), to: nameOf(relation.toId) }))) return;
    setBusy(true);
    setError("");
    try {
      await castApi.removeRelation(workId, relation);
      onRemoved(relation.id);
      onClose();
    } catch (cause) {
      setError(errorText(t, cause));
      setConflict(cause instanceof ApiError && cause.code === "REVISION_CONFLICT");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialogRef} className="dialog cast-dialog" onClose={onClose} aria-labelledby="relation-dialog-title" data-testid="relation-dialog">
      <form onSubmit={save} className="dialog-body">
        <h2 id="relation-dialog-title" className="display dialog-title">{relation ? t("cast.relation.editTitle") : t("cast.relation.newTitle")}</h2>
        <div className="relation-ends">
          <span className="relation-end" lang={language} data-testid="relation-from">{nameOf(draft.fromId)}</span>
          <span aria-hidden="true">{draft.kind === "mentor" ? "→" : "—"}</span>
          <span className="relation-end" lang={language} data-testid="relation-to">{nameOf(draft.toId)}</span>
          <button type="button" className="btn quiet" onClick={() => setDraft({ ...draft, fromId: draft.toId, toId: draft.fromId })} data-testid="relation-swap">{t("cast.relation.swap")}</button>
        </div>
        {draft.kind === "mentor" ? <p className="muted assist-hint">{t("cast.relation.mentorReads", { from: nameOf(draft.fromId), to: nameOf(draft.toId) })}</p> : null}

        <fieldset className="dialog-fieldset">
          <legend className="caps">{t("cast.relation.kind")}</legend>
          <div className="relation-kinds">
            {RELATION_KINDS.map((kind: RelationKind) => (
              <label key={kind} className={draft.kind === kind ? "btn on relation-kind" : "btn relation-kind"} data-testid={`relation-kind-${kind}`} data-state={draft.kind === kind ? "on" : "off"}>
                <input type="radio" name="relation-kind" className="visually-hidden" value={kind} checked={draft.kind === kind} onChange={() => setDraft({ ...draft, kind })} />
                {t(`cast.relation.kinds.${kind}`)}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="caps" htmlFor="relation-label">{t("cast.relation.label")}</label>
        <input id="relation-label" className="field" maxLength={120} lang={language} value={draft.label} placeholder={t("cast.relation.labelHint")} onChange={(event) => setDraft({ ...draft, label: event.target.value })} data-testid="relation-label-input" />

        <label className="caps" htmlFor="relation-tension">{t("cast.relation.tension")}</label>
        <textarea id="relation-tension" className="field scene-text" rows={3} maxLength={1000} lang={language} value={draft.tension} placeholder={t("cast.relation.tensionHint")} onChange={(event) => setDraft({ ...draft, tension: event.target.value })} data-testid="relation-tension" />

        {error ? (
          <div className="notice cast-error" role="alert" data-testid="relation-error">
            <span>{error}</span>
            {conflict ? <button type="button" className="btn" onClick={() => void loadSaved()} disabled={busy} data-testid="relation-load-saved">{t("cast.loadSaved")}</button> : null}
          </div>
        ) : null}

        <div className="dialog-row dialog-actions">
          <button type="submit" className="btn primary" disabled={busy} data-testid="relation-save">{busy ? t("write.saving") : t("ideate.save")}</button>
          <button type="button" className="btn" onClick={onClose} disabled={busy} data-testid="relation-cancel">{t("ideate.cancel")}</button>
          {relation ? <button type="button" className="btn quiet cast-delete" onClick={() => void remove()} disabled={busy} data-testid="relation-delete">{t("cast.relation.delete")}</button> : null}
        </div>
      </form>
    </dialog>
  );
}
