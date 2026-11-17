import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, errorText, type WorkSummary } from "../api";
import { castApi, type Entity, type EventDraft, type StoryEvent } from "../castApi";
import { writeApi } from "../writeApi";
import { numeral } from "../sections";

// Timeline (plan 5.7, mockup Timeline.dc.html): what happens, to whom, and in
// what order the reader learns it. Two orders of the same events: as it
// happened (story order, which the writer arranges) and as it is told
// (the order of the chapters that tell them; a flashback is an event told
// after something that happens later).

type Order = "happened" | "told";
const ORDER_KEY = "novel-studio:timeline-order";
type ChapterRef = { id: string; title: string };
type Loaded =
  | { state: "loading" }
  | { state: "ready"; events: StoryEvent[]; entities: Entity[]; chapters: ChapterRef[]; canonRevision: number }
  | { state: "failed"; message: string };
type Editing = { mode: "new" } | { mode: "edit"; event: StoryEvent } | null;

function storedOrder(): Order {
  try {
    return window.localStorage.getItem(ORDER_KEY) === "told" ? "told" : "happened";
  } catch {
    return "happened";
  }
}

export interface PlacedEvent {
  event: StoryEvent;
  /** Index of its chapter, or -1 while it is not told yet. */
  chapterIndex: number;
  /** Told after an event that happens later in the story. */
  flashback: boolean;
}

/** The events in either order. Told order: by chapter, events not told yet last; within a chapter, by story order. */
export function placeEvents(events: StoryEvent[], chapters: ChapterRef[], order: Order): PlacedEvent[] {
  const index = new Map(chapters.map((chapter, position) => [chapter.id, position]));
  const placed = events.map((event) => ({ event, chapterIndex: index.get(event.chapterId) ?? -1, flashback: false }));
  const byStory = (a: PlacedEvent, b: PlacedEvent) => a.event.storyOrder - b.event.storyOrder || a.event.createdAt.localeCompare(b.event.createdAt);
  const told = [...placed].sort((a, b) => {
    const ca = a.chapterIndex < 0 ? Number.MAX_SAFE_INTEGER : a.chapterIndex;
    const cb = b.chapterIndex < 0 ? Number.MAX_SAFE_INTEGER : b.chapterIndex;
    return ca - cb || byStory(a, b);
  });
  let latest = -Infinity;
  for (const item of told) {
    if (item.chapterIndex < 0) continue;
    if (item.event.storyOrder < latest) item.flashback = true;
    latest = Math.max(latest, item.event.storyOrder);
  }
  return order === "told" ? told : [...placed].sort(byStory);
}

function EventDialog({ workId, language, editing, characters, places, chapters, onClose, onSaved, onRemoved, onReload }: {
  workId: string;
  language: string;
  editing: Editing;
  characters: Entity[];
  places: Entity[];
  chapters: ChapterRef[];
  onClose: () => void;
  onSaved: () => void;
  onRemoved: () => void;
  onReload: () => Promise<StoryEvent | null>;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const empty: EventDraft = { title: "", summary: "", timeLabel: "", chapterId: "", participantIds: [], locationId: "" };
  const [draft, setDraft] = useState<EventDraft>(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const event = editing?.mode === "edit" ? editing.event : null;

  const fill = (value: StoryEvent | null) => setDraft(value
    ? { title: value.title, summary: value.summary, timeLabel: value.timeLabel, chapterId: value.chapterId, participantIds: value.participantIds, locationId: value.locationId }
    : empty);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (editing && !dialog.open) {
      fill(event);
      setError("");
      setConflict(false);
      dialog.showModal();
    } else if (!editing && dialog.open) dialog.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, event]);

  async function save(submit: FormEvent) {
    submit.preventDefault();
    if (!draft.title.trim()) {
      setError(t("errors.CANON_NAME_REQUIRED"));
      return;
    }
    setBusy(true);
    setError("");
    setConflict(false);
    const payload = { ...draft, title: draft.title.trim(), summary: draft.summary.trim(), timeLabel: draft.timeLabel.trim() };
    try {
      if (event) await castApi.updateEvent(workId, event, payload);
      else await castApi.createEvent(workId, payload);
      onSaved();
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
    if (!event || !window.confirm(t("timeline.deleteConfirm", { title: event.title }))) return;
    setBusy(true);
    setError("");
    try {
      await castApi.removeEvent(workId, event);
      onRemoved();
      onClose();
    } catch (cause) {
      setError(errorText(t, cause));
      setConflict(cause instanceof ApiError && cause.code === "REVISION_CONFLICT");
    } finally {
      setBusy(false);
    }
  }

  const toggleParticipant = (id: string) => setDraft((current) => ({
    ...current,
    participantIds: current.participantIds.includes(id) ? current.participantIds.filter((item) => item !== id) : [...current.participantIds, id]
  }));

  return (
    <dialog ref={dialogRef} className="dialog cast-dialog" onClose={onClose} aria-labelledby="event-dialog-title" data-testid="event-dialog">
      <form onSubmit={save} className="dialog-body" noValidate>
        <h2 id="event-dialog-title" className="display dialog-title">{event ? t("timeline.editTitle") : t("timeline.newTitle")}</h2>
        <label className="caps" htmlFor="event-title">{t("timeline.fields.title")}</label>
        <input id="event-title" className="field" maxLength={200} lang={language} value={draft.title} placeholder={t("timeline.addPlaceholder")} onChange={(change) => setDraft({ ...draft, title: change.target.value })} data-testid="event-title" />
        <label className="caps" htmlFor="event-summary">{t("timeline.fields.summary")}</label>
        <textarea id="event-summary" className="field scene-text" rows={3} maxLength={4000} lang={language} value={draft.summary} onChange={(change) => setDraft({ ...draft, summary: change.target.value })} data-testid="event-summary" />
        <div className="dialog-row">
          <div className="dialog-field">
            <label className="caps" htmlFor="event-when">{t("timeline.fields.when")}</label>
            <input id="event-when" className="field" maxLength={240} lang={language} value={draft.timeLabel} placeholder={t("timeline.whenHint")} onChange={(change) => setDraft({ ...draft, timeLabel: change.target.value })} data-testid="event-when" />
          </div>
          <div className="dialog-field">
            <label className="caps" htmlFor="event-chapter">{t("timeline.fields.chapter")}</label>
            <select id="event-chapter" className="field" value={draft.chapterId} onChange={(change) => setDraft({ ...draft, chapterId: change.target.value })} data-testid="event-chapter">
              <option value="">{t("timeline.notTold")}</option>
              {chapters.map((chapter, index) => <option key={chapter.id} value={chapter.id} lang={language}>{index + 1}. {chapter.title}</option>)}
            </select>
          </div>
        </div>
        {characters.length ? (
          <fieldset className="dialog-fieldset">
            <legend className="caps">{t("timeline.fields.who")}</legend>
            <div className="event-people">
              {characters.map((person) => (
                <label key={person.id} className="scene-check">
                  <input type="checkbox" checked={draft.participantIds.includes(person.id)} onChange={() => toggleParticipant(person.id)} data-testid="event-participant" data-entity-id={person.id} />
                  <span lang={language}>{person.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        {places.length ? (
          <>
            <label className="caps" htmlFor="event-place">{t("timeline.fields.where")}</label>
            <select id="event-place" className="field" value={draft.locationId} onChange={(change) => setDraft({ ...draft, locationId: change.target.value })} data-testid="event-place">
              <option value="">{t("timeline.noPlace")}</option>
              {places.map((place) => <option key={place.id} value={place.id} lang={language}>{place.name}</option>)}
            </select>
          </>
        ) : null}

        {error ? (
          <div className="notice cast-error" role="alert" data-testid="event-error">
            <span>{error}</span>
            {conflict ? <button type="button" className="btn" onClick={() => void loadSaved()} disabled={busy} data-testid="event-load-saved">{t("cast.loadSaved")}</button> : null}
          </div>
        ) : null}
        <div className="dialog-row dialog-actions">
          <button type="submit" className="btn primary" disabled={busy} data-testid="event-save">{busy ? t("write.saving") : t("ideate.save")}</button>
          <button type="button" className="btn" onClick={onClose} disabled={busy} data-testid="event-cancel">{t("ideate.cancel")}</button>
          {event ? <button type="button" className="btn quiet cast-delete" onClick={() => void remove()} disabled={busy} data-testid="event-delete">{t("timeline.delete")}</button> : null}
        </div>
      </form>
    </dialog>
  );
}

export default function Timeline({ work }: { work: WorkSummary }) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [order, setOrder] = useState<Order>(storedOrder);
  const [editing, setEditing] = useState<Editing>(null);
  const [quick, setQuick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [{ canon }, { work: full }] = await Promise.all([castApi.canon(work.id), writeApi.work(work.id)]);
    const next = {
      state: "ready" as const,
      events: canon.events ?? [],
      entities: canon.entities,
      chapters: full.chapters.map((chapter) => ({ id: chapter.id, title: chapter.title })),
      canonRevision: canon.canonRevision
    };
    setLoaded(next);
    return next;
  }, [work.id]);

  useEffect(() => {
    load().catch((cause) => setLoaded({ state: "failed", message: errorText(t, cause) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  function chooseOrder(next: Order) {
    setOrder(next);
    try {
      window.localStorage.setItem(ORDER_KEY, next);
    } catch {
      // Remembering the order is a convenience only.
    }
  }

  async function addQuick(submit: FormEvent) {
    submit.preventDefault();
    const title = quick.trim();
    if (!title || busy) return;
    setBusy(true);
    setError("");
    try {
      await castApi.createEvent(work.id, { title });
      setQuick("");
      await load();
    } catch (cause) {
      setError(errorText(t, cause));
    } finally {
      setBusy(false);
    }
  }

  async function move(placed: PlacedEvent[], index: number, delta: number) {
    if (loaded.state !== "ready") return;
    const ids = placed.map((item) => item.event.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setBusy(true);
    setError("");
    try {
      await castApi.reorderEvents(work.id, ids, loaded.canonRevision);
      await load();
    } catch (cause) {
      setError(errorText(t, cause));
      // Someone else changed the story meanwhile: show it as it is now.
      if (cause instanceof ApiError && cause.code === "REVISION_CONFLICT") await load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function reloadEditing(): Promise<StoryEvent | null> {
    const fresh = await load();
    const id = editing?.mode === "edit" ? editing.event.id : "";
    const event = fresh.events.find((item) => item.id === id) ?? null;
    if (event) setEditing({ mode: "edit", event });
    return event;
  }

  const ready = loaded.state === "ready" ? loaded : null;
  const placed = ready ? placeEvents(ready.events, ready.chapters, order) : [];
  const names = new Map((ready?.entities ?? []).map((entity) => [entity.id, entity.name]));
  const chapterTitle = (index: number) => (ready && index >= 0 ? `${index + 1}. ${ready.chapters[index].title}` : t("timeline.notTold"));

  return (
    <div className="timeline" data-testid="timeline" data-order={order}>
      <header className="cast-head">
        <div>
          <div className="caps">{t("timeline.part")}</div>
          <h1 className="display page-title">{t("nav.timeline")}</h1>
          <p className="page-subtitle muted">{t("timeline.subtitle")}</p>
        </div>
        <div className="cast-actions">
          <div className="cast-views" role="group" aria-label={t("timeline.orderLabel")}>
            {(["happened", "told"] as const).map((item) => (
              <button key={item} type="button" className={order === item ? "btn on" : "btn"} aria-pressed={order === item} onClick={() => chooseOrder(item)} data-testid={`timeline-order-${item}`}>
                {t(`timeline.orders.${item}`)}
              </button>
            ))}
          </div>
          <button type="button" className="btn primary" onClick={() => setEditing({ mode: "new" })} data-testid="event-new">{t("timeline.new")}</button>
        </div>
      </header>
      <hr className="rule2" />

      {loaded.state === "loading" ? <p className="muted">{t("app.loading")}</p> : null}
      {loaded.state === "failed" ? <p className="notice" role="alert">{loaded.message}</p> : null}

      {ready ? (
        <section className="timeline-list" aria-label={t("timeline.listLabel")}>
          <div className="caps">{t(`timeline.listHeading.${order}`)}</div>
          {placed.length === 0 ? <p className="muted cast-empty" data-testid="timeline-empty">{t("timeline.empty")}</p> : null}
          <ol className="timeline-events">
            {placed.map((item, index) => {
              const { event } = item;
              const people = event.participantIds.map((id) => names.get(id)).filter(Boolean).join(t("timeline.listSeparator"));
              const place = names.get(event.locationId);
              const head = order === "happened" ? (event.timeLabel || t("timeline.notPlaced")) : chapterTitle(item.chapterIndex);
              const sub = order === "happened"
                ? (item.chapterIndex >= 0 ? t("timeline.toldIn", { chapter: chapterTitle(item.chapterIndex) }) : t("timeline.notTold"))
                : item.flashback ? t("timeline.flashbackTo", { when: event.timeLabel || t("timeline.earlier") }) : event.timeLabel;
              return (
                <li key={event.id} className="card timeline-event" data-testid="timeline-event" data-event-id={event.id} data-flashback={item.flashback} data-told={item.chapterIndex >= 0}>
                  <span className="timeline-num" aria-hidden="true">{numeral(index)}</span>
                  <button type="button" className="timeline-open" onClick={() => setEditing({ mode: "edit", event })} data-testid="timeline-open">
                    <span className="caps" lang={work.language}>{head}</span>
                    <span className="timeline-title" lang={work.language} data-testid="timeline-title">{event.title}</span>
                    {sub ? <span className={item.flashback ? "timeline-sub flashback" : "timeline-sub"} lang={work.language} data-testid="timeline-sub">{sub}</span> : null}
                    {people || place ? <span className="timeline-sub" lang={work.language}>{[people, place].filter(Boolean).join(" · ")}</span> : null}
                  </button>
                  {order === "happened" ? (
                    <span className="timeline-move">
                      <button type="button" className="btn quiet" disabled={busy || index === 0} onClick={() => void move(placed, index, -1)} aria-label={t("timeline.earlierAria", { title: event.title })} data-testid="event-up">↑</button>
                      <button type="button" className="btn quiet" disabled={busy || index === placed.length - 1} onClick={() => void move(placed, index, 1)} aria-label={t("timeline.laterAria", { title: event.title })} data-testid="event-down">↓</button>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {order === "told" && placed.length ? <p className="muted assist-hint">{t("timeline.toldHint")}</p> : null}
          <form className="timeline-add" onSubmit={addQuick}>
            <label className="caps" htmlFor="event-quick">{t("timeline.addLabel")}</label>
            <div className="dialog-row">
              <input id="event-quick" className="field" maxLength={200} lang={work.language} value={quick} placeholder={t("timeline.addPlaceholder")} onChange={(change) => setQuick(change.target.value)} disabled={busy} data-testid="event-quick" />
              <button type="submit" className="btn" disabled={busy || !quick.trim()} data-testid="event-quick-add">{t("timeline.add")}</button>
            </div>
          </form>
          {error ? <p className="notice" role="alert" data-testid="timeline-error">{error}</p> : null}
        </section>
      ) : null}

      {ready ? (
        <EventDialog
          workId={work.id}
          language={work.language}
          editing={editing}
          characters={ready.entities.filter((entity) => entity.type === "character")}
          places={ready.entities.filter((entity) => entity.type === "location")}
          chapters={ready.chapters}
          onClose={() => setEditing(null)}
          onSaved={() => void load()}
          onRemoved={() => void load()}
          onReload={reloadEditing}
        />
      ) : null}
    </div>
  );
}
