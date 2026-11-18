import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, errorText } from "../api";
import { castApi, type Setup, type SetupAnchor, type SetupDraft, type StoryEvent } from "../castApi";

// Setups and payoffs (plan 5.7 "foreshadowing", mockup Timeline "Planted, not
// yet paid off"): something planted in a chapter or an event that should pay
// off later. Open setups that are already planted are listed as reminders.

type ChapterRef = { id: string; title: string };
type Editing = { mode: "new" } | { mode: "edit"; setup: Setup } | null;

const anchorValue = (anchor: SetupAnchor | null) => (anchor ? `${anchor.kind}:${anchor.id}` : "");
function parseAnchor(value: string): SetupAnchor | null {
  const [kind, id] = value.split(":");
  return (kind === "chapter" || kind === "event") && id ? { kind, id } : null;
}

export function useAnchorLabel(chapters: ChapterRef[], events: StoryEvent[]) {
  const { t } = useTranslation();
  return (anchor: SetupAnchor | null): string => {
    if (!anchor) return "";
    if (anchor.kind === "chapter") {
      const index = chapters.findIndex((chapter) => chapter.id === anchor.id);
      if (index < 0) return t("setups.missing");
      const title = chapters[index].title;
      // "Chapter 1 (Chapter 1)" says nothing twice: a title with its number stands alone.
      return title.includes(String(index + 1)) ? t("setups.chapterTitle", { title }) : t("setups.inChapter", { number: index + 1, title });
    }
    const event = events.find((item) => item.id === anchor.id);
    return event ? t("setups.inEvent", { title: event.title }) : t("setups.missing");
  };
}

function AnchorSelect({ id, label, value, chapters, events, language, none, onChange, testId }: {
  id: string;
  label: string;
  value: SetupAnchor | null;
  chapters: ChapterRef[];
  events: StoryEvent[];
  language: string;
  none: string;
  onChange: (anchor: SetupAnchor | null) => void;
  testId: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="dialog-field">
      <label className="caps" htmlFor={id}>{label}</label>
      <select id={id} className="field" value={anchorValue(value)} onChange={(change) => onChange(parseAnchor(change.target.value))} data-testid={testId}>
        <option value="">{none}</option>
        {chapters.length ? (
          <optgroup label={t("setups.chapters")}>
            {chapters.map((chapter, index) => <option key={chapter.id} value={`chapter:${chapter.id}`} lang={language}>{index + 1}. {chapter.title}</option>)}
          </optgroup>
        ) : null}
        {events.length ? (
          <optgroup label={t("setups.events")}>
            {events.map((event) => <option key={event.id} value={`event:${event.id}`} lang={language}>{event.title}</option>)}
          </optgroup>
        ) : null}
      </select>
    </div>
  );
}

function SetupDialog({ workId, language, editing, chapters, events, onClose, onChanged, onReload }: {
  workId: string;
  language: string;
  editing: Editing;
  chapters: ChapterRef[];
  events: StoryEvent[];
  onClose: () => void;
  onChanged: () => void;
  onReload: () => Promise<Setup | null>;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const empty: SetupDraft = { description: "", plantedIn: null, paidOffIn: null, status: "open" };
  const [draft, setDraft] = useState<SetupDraft>(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const setup = editing?.mode === "edit" ? editing.setup : null;
  const fill = (value: Setup | null) => setDraft(value ? { description: value.description, plantedIn: value.plantedIn, paidOffIn: value.paidOffIn, status: value.status } : empty);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (editing && !dialog.open) {
      fill(setup);
      setError("");
      setConflict(false);
      dialog.showModal();
    } else if (!editing && dialog.open) dialog.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, setup]);

  async function save(submit: FormEvent) {
    submit.preventDefault();
    if (!draft.description.trim()) {
      setError(t("errors.CANON_NAME_REQUIRED"));
      return;
    }
    setBusy(true);
    setError("");
    setConflict(false);
    const payload = { ...draft, description: draft.description.trim() };
    try {
      if (setup) await castApi.updateSetup(workId, setup, payload);
      else await castApi.createSetup(workId, payload);
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
    if (!setup || !window.confirm(t("setups.deleteConfirm"))) return;
    setBusy(true);
    try {
      await castApi.removeSetup(workId, setup);
      onChanged();
      onClose();
    } catch (cause) {
      setError(errorText(t, cause));
      setConflict(cause instanceof ApiError && cause.code === "REVISION_CONFLICT");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialogRef} className="dialog cast-dialog" onClose={onClose} aria-labelledby="setup-dialog-title" data-testid="setup-dialog">
      <form onSubmit={save} className="dialog-body" noValidate>
        <h2 id="setup-dialog-title" className="display dialog-title">{setup ? t("setups.editTitle") : t("setups.newTitle")}</h2>
        <label className="caps" htmlFor="setup-description">{t("setups.description")}</label>
        <input id="setup-description" className="field" maxLength={2000} lang={language} value={draft.description} placeholder={t("setups.descriptionHint")} onChange={(change) => setDraft({ ...draft, description: change.target.value })} data-testid="setup-description" />
        <div className="dialog-row">
          <AnchorSelect id="setup-planted" label={t("setups.plantedIn")} value={draft.plantedIn} chapters={chapters} events={events} language={language} none={t("setups.notPlanted")} onChange={(plantedIn) => setDraft({ ...draft, plantedIn })} testId="setup-planted" />
          <AnchorSelect id="setup-payoff" label={t("setups.paidOffIn")} value={draft.paidOffIn} chapters={chapters} events={events} language={language} none={t("setups.noPayoff")} onChange={(paidOffIn) => setDraft({ ...draft, paidOffIn })} testId="setup-payoff" />
        </div>
        <fieldset className="dialog-fieldset">
          <legend className="caps">{t("setups.statusLabel")}</legend>
          <div className="event-people">
            {(["open", "paid", "dropped"] as const).map((status) => (
              <label key={status} className="scene-check">
                <input type="radio" name="setup-status" checked={draft.status === status} onChange={() => setDraft({ ...draft, status })} data-testid={`setup-status-${status}`} />
                <span>{t(`setups.status.${status}`)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {error ? (
          <div className="notice cast-error" role="alert" data-testid="setup-error">
            <span>{error}</span>
            {conflict ? <button type="button" className="btn" onClick={() => void loadSaved()} disabled={busy}>{t("cast.loadSaved")}</button> : null}
          </div>
        ) : null}
        <div className="dialog-row dialog-actions">
          <button type="submit" className="btn primary" disabled={busy} data-testid="setup-save">{busy ? t("write.saving") : t("ideate.save")}</button>
          <button type="button" className="btn" onClick={onClose} disabled={busy} data-testid="setup-cancel">{t("ideate.cancel")}</button>
          {setup ? <button type="button" className="btn quiet cast-delete" onClick={() => void remove()} disabled={busy} data-testid="setup-delete">{t("setups.delete")}</button> : null}
        </div>
      </form>
    </dialog>
  );
}

/** Reminders for setups still waiting, and every setup by state. */
export function SetupsPanel({ workId, language, setups, chapters, events, onChanged, onReload }: {
  workId: string;
  language: string;
  setups: Setup[];
  chapters: ChapterRef[];
  events: StoryEvent[];
  onChanged: () => void;
  onReload: () => Promise<Setup[]>;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<Editing>(null);
  const label = useAnchorLabel(chapters, events);
  const waiting = setups.filter((setup) => setup.status === "open" && setup.plantedIn);
  const unplanted = setups.filter((setup) => setup.status === "open" && !setup.plantedIn);
  const settled = setups.filter((setup) => setup.status !== "open");

  const item = (setup: Setup) => (
    <li key={setup.id}>
      <button type="button" className="setup-item" onClick={() => setEditing({ mode: "edit", setup })} data-testid="setup-item" data-setup-id={setup.id} data-status={setup.status}>
        <strong lang={language}>{setup.description}</strong>
        <span className="muted setup-where" lang={language}>
          {setup.plantedIn ? t("setups.planted", { where: label(setup.plantedIn) }) : t("setups.notPlantedYet")}
          {setup.paidOffIn ? ` · ${setup.status === "paid" ? t("setups.paidIn", { where: label(setup.paidOffIn) }) : t("setups.plannedIn", { where: label(setup.paidOffIn) })}` : ""}
          {setup.status === "dropped" ? ` · ${t("setups.status.dropped")}` : ""}
        </span>
      </button>
    </li>
  );

  return (
    <section className="setups" aria-label={t("setups.label")} data-testid="setups">
      <div className="setups-head">
        <div className="caps">{t("setups.label")}</div>
        <button type="button" className="btn" onClick={() => setEditing({ mode: "new" })} data-testid="setup-new">{t("setups.new")}</button>
      </div>
      {waiting.length ? (
        <div className="card setups-reminder" data-testid="setups-waiting">
          <div className="caps">{t("setups.waiting", { count: waiting.length })}</div>
          <ul className="setups-list">{waiting.map(item)}</ul>
          <p className="muted assist-hint">{t("setups.waitingHint")}</p>
        </div>
      ) : null}
      {unplanted.length ? (
        <div data-testid="setups-unplanted">
          <div className="caps">{t("setups.unplanted")}</div>
          <ul className="setups-list">{unplanted.map(item)}</ul>
        </div>
      ) : null}
      {settled.length ? (
        <details data-testid="setups-settled">
          <summary className="caps">{t("setups.settled", { count: settled.length })}</summary>
          <ul className="setups-list">{settled.map(item)}</ul>
        </details>
      ) : null}
      {setups.length === 0 ? <p className="muted cast-empty">{t("setups.empty")}</p> : null}
      <SetupDialog
        workId={workId}
        language={language}
        editing={editing}
        chapters={chapters}
        events={events}
        onClose={() => setEditing(null)}
        onChanged={onChanged}
        onReload={async () => {
          const fresh = await onReload();
          const id = editing?.mode === "edit" ? editing.setup.id : "";
          const setup = fresh.find((candidate) => candidate.id === id) ?? null;
          if (setup) setEditing({ mode: "edit", setup });
          return setup;
        }}
      />
    </section>
  );
}
