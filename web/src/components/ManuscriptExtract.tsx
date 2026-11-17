import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, errorText } from "../api";
import { castApi, type Entity, type ExtractTask, type ManuscriptDrafts } from "../castApi";

// "Find the people and events in the manuscript" (plan 5.1.1 Write path,
// 5.5 "find characters in the text"). The AI reads the chapters one by one
// in the background; what it found opens as a list of drafts to tick. Only
// the ticked ones are added, as cards, relationships and events.

const TERMINAL = new Set(["completed", "failed", "cancelled", "interrupted"]);
type Picked = { characters: Set<number>; relations: Set<number>; events: Set<number> };

export function ManuscriptExtract({ workId, language, entities, onAdded }: {
  workId: string;
  language: string;
  /** Everything already in the story's canon (names link relations and events to them). */
  entities: Entity[];
  /** Called after adding, with a line saying what was added (or what was, before a failure). */
  onAdded: (notice: string) => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [task, setTask] = useState<ExtractTask | null>(null);
  const [drafts, setDrafts] = useState<(ManuscriptDrafts & { chaptersRead: number; chaptersWithText: number; shortened: number }) | null>(null);
  const [picked, setPicked] = useState<Picked>({ characters: new Set(), relations: new Set(), events: new Set() });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const stopRef = useRef(false);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (drafts && !dialog.open) dialog.showModal();
    else if (!drafts && dialog.open) dialog.close();
  }, [drafts]);
  useEffect(() => () => { stopRef.current = true; }, []);

  async function start() {
    setError("");
    stopRef.current = false;
    try {
      let { task: current } = await castApi.extractManuscript(workId);
      setTask(current);
      while (!TERMINAL.has(current.status)) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        if (stopRef.current) return;
        current = (await castApi.task(current.id)).task;
        setTask(current);
      }
      if (current.status !== "completed" || !current.result) {
        throw new ApiError(current.errorStatus ?? 409, current.errorCode ?? (current.status === "cancelled" ? "TASK_CANCELLED" : "TASK_NOT_COMPLETED"), current.message ?? "", current.errorParams ?? {});
      }
      const result = current.result;
      const all = (list: unknown[]) => new Set(list.map((_, index) => index));
      setPicked({ characters: all(result.drafts.characters), relations: all(result.drafts.relations), events: all(result.drafts.events) });
      setDrafts({ ...result.drafts, chaptersRead: result.chaptersRead, chaptersWithText: result.chaptersWithText, shortened: result.shortened.length });
    } catch (cause) {
      if (!(cause instanceof ApiError && cause.code === "TASK_CANCELLED")) setError(errorText(t, cause));
    } finally {
      setTask(null);
    }
  }

  function stop() {
    if (task) void castApi.cancelTask(task.id).catch(() => undefined);
  }

  const toggle = (group: keyof Picked, index: number) => setPicked((current) => {
    const next = new Set(current[group]);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    return { ...current, [group]: next };
  });

  // A name is available if it is already in the canon, or a ticked new card.
  const existing = new Map(entities.flatMap((entity) => [entity.name, ...entity.aliases].map((name) => [name.toLocaleLowerCase(), entity] as const)));
  const tickedNames = new Set(drafts ? [...picked.characters].map((index) => drafts.characters[index].name.toLocaleLowerCase()) : []);
  const available = (name: string) => existing.has(name.toLocaleLowerCase()) || tickedNames.has(name.toLocaleLowerCase());

  async function add() {
    if (!drafts) return;
    setBusy(true);
    setError("");
    const ids = new Map([...existing].filter(([, entity]) => entity.type === "character").map(([name, entity]) => [name, entity.id]));
    const places = new Map(entities.filter((entity) => entity.type === "location").flatMap((entity) => [entity.name, ...entity.aliases].map((name) => [name.toLocaleLowerCase(), entity.id] as const)));
    const counts = { characters: 0, relations: 0, events: 0 };
    try {
      for (const index of [...picked.characters].sort((a, b) => a - b)) {
        const person = drafts.characters[index];
        const { item } = await castApi.create(workId, "character", { name: person.name, aliases: person.aliases, summary: person.summary, card: person.card.want ? { want: person.card.want } : {}, notes: "" });
        for (const name of [person.name, ...person.aliases]) ids.set(name.toLocaleLowerCase(), item.id);
        counts.characters += 1;
      }
      for (const index of [...picked.relations].sort((a, b) => a - b)) {
        const relation = drafts.relations[index];
        const fromId = ids.get(relation.from.toLocaleLowerCase());
        const toId = ids.get(relation.to.toLocaleLowerCase());
        if (!fromId || !toId || fromId === toId) continue;
        await castApi.createRelation(workId, { fromId, toId, kind: relation.kind, label: relation.label, tension: relation.tension });
        counts.relations += 1;
      }
      for (const index of [...picked.events].sort((a, b) => a - b)) {
        const event = drafts.events[index];
        const participantIds = [...new Set(event.participants.map((name) => ids.get(name.toLocaleLowerCase())).filter((id): id is string => Boolean(id)))];
        await castApi.createEvent(workId, { title: event.title, summary: event.summary, chapterId: event.chapterId, participantIds, locationId: places.get(event.location.toLocaleLowerCase()) ?? "" });
        counts.events += 1;
      }
      setDrafts(null);
      onAdded(t("extract.added", counts));
    } catch (cause) {
      setError(`${errorText(t, cause)} ${t("extract.partly", counts)}`);
      onAdded("");
    } finally {
      setBusy(false);
    }
  }

  const progress = task?.progress;
  return (
    <div className="extract" data-testid="extract">
      <p className="muted assist-hint">{t("extract.intro")}</p>
      {task ? (
        <div className="dialog-row extract-running">
          <span className="muted" role="status" data-testid="extract-progress">
            {progress && progress.total ? t("extract.reading", { done: Math.min(progress.done + 1, progress.total), total: progress.total }) : t("extract.starting")}
          </span>
          <button type="button" className="btn" onClick={stop} data-testid="extract-stop">{t("ideate.stop")}</button>
        </div>
      ) : (
        <button type="button" className="btn" onClick={() => void start()} data-testid="extract-start">{t("extract.start")}</button>
      )}
      {error && !drafts ? <p className="notice" role="alert" data-testid="extract-error">{error}</p> : null}

      <dialog ref={dialogRef} className="dialog extract-dialog" onClose={() => setDrafts(null)} aria-labelledby="extract-title" data-testid="extract-dialog">
        {drafts ? (
          <div className="dialog-body">
            <h2 id="extract-title" className="display dialog-title">{t("extract.title")}</h2>
            <p className="muted assist-hint">
              {t("extract.summary", { read: drafts.chaptersRead, total: drafts.chaptersWithText })}
              {drafts.shortened ? ` ${t("extract.shortened", { count: drafts.shortened })}` : ""}
            </p>

            <section className="extract-group" data-testid="extract-characters">
              <div className="caps">{t("extract.characters", { count: drafts.characters.length })}</div>
              {drafts.characters.length === 0 ? <p className="muted assist-hint">{t("extract.noneNew")}</p> : null}
              {drafts.characters.map((person, index) => (
                <label key={`c${index}`} className="scene-check extract-item" data-testid="extract-character" data-name={person.name}>
                  <input type="checkbox" checked={picked.characters.has(index)} onChange={() => toggle("characters", index)} />
                  <span>
                    <strong lang={language}>{person.name}</strong>
                    {person.aliases.length ? <span className="muted" lang={language}> ({person.aliases.join(", ")})</span> : null}
                    {person.summary ? <span className="muted extract-detail" lang={language}>{person.summary}</span> : null}
                  </span>
                </label>
              ))}
            </section>

            {drafts.relations.length ? (
              <section className="extract-group" data-testid="extract-relations">
                <div className="caps">{t("extract.relations", { count: drafts.relations.length })}</div>
                {drafts.relations.map((relation, index) => {
                  const possible = available(relation.from) && available(relation.to);
                  return (
                    <label key={`r${index}`} className="scene-check extract-item" data-testid="extract-relation" data-state={possible ? "possible" : "missing"}>
                      <input type="checkbox" checked={possible && picked.relations.has(index)} disabled={!possible} onChange={() => toggle("relations", index)} />
                      <span>
                        <strong lang={language}>{relation.from} {relation.kind === "mentor" ? "→" : "—"} {relation.to}</strong>
                        <span className="muted" lang={relation.label ? language : undefined}> · {relation.label || t(`cast.relation.kinds.${relation.kind}`)}</span>
                        {relation.tension ? <span className="muted extract-detail" lang={language}>{relation.tension}</span> : null}
                        {possible ? null : <span className="muted extract-detail">{t("extract.needsBoth")}</span>}
                      </span>
                    </label>
                  );
                })}
              </section>
            ) : null}

            {drafts.events.length ? (
              <section className="extract-group" data-testid="extract-events">
                <div className="caps">{t("extract.events", { count: drafts.events.length })}</div>
                {drafts.events.map((event, index) => (
                  <label key={`e${index}`} className="scene-check extract-item" data-testid="extract-event">
                    <input type="checkbox" checked={picked.events.has(index)} onChange={() => toggle("events", index)} />
                    <span>
                      <span className="caps" lang={language}>{event.chapterTitle}</span>
                      <strong lang={language}>{event.title}</strong>
                      {event.participants.length ? <span className="muted extract-detail" lang={language}>{event.participants.join(", ")}{event.location ? ` · ${event.location}` : ""}</span> : null}
                    </span>
                  </label>
                ))}
              </section>
            ) : null}

            {error ? <p className="notice" role="alert" data-testid="extract-error">{error}</p> : null}
            <div className="dialog-row dialog-actions">
              <button type="button" className="btn primary" disabled={busy || (picked.characters.size + picked.relations.size + picked.events.size === 0)} onClick={() => void add()} data-testid="extract-add">
                {busy ? t("write.saving") : t("extract.add")}
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => setDrafts(null)} data-testid="extract-cancel">{t("ideate.cancel")}</button>
            </div>
            <p className="muted assist-hint">{t("extract.unchanged")}</p>
          </div>
        ) : null}
      </dialog>
    </div>
  );
}
