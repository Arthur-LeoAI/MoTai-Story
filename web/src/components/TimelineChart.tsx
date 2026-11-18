import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Entity, Setup, SetupAnchor, StoryEvent, Thread } from "../castApi";
import { numeral } from "../sections";

// The chart of persons and events (plan 5.7 "swimlanes", mockup Fig. 2): one
// row per person, plot line or place, one column per event in the order the
// Timeline shows. A dot marks an event the row takes part in; a line joins a
// row's first and last event. It is a table, so a screen reader can read it
// row by row.

export type ChartRows = "people" | "threads" | "places";
const ROWS_KEY = "novel-studio:timeline-rows";

function storedRows(): ChartRows {
  try {
    const value = window.localStorage.getItem(ROWS_KEY);
    return value === "threads" || value === "places" ? value : "people";
  } catch {
    return "people";
  }
}

export interface ChartColumn {
  event: StoryEvent;
  head: string;
  sub: string;
  flashback: boolean;
}

interface Row {
  id: string;
  name: string;
  hits: boolean[];
}

// Where a setup sits on the chart: its event's column, or the first column
// told in its chapter. -1 when there is no such column.
function columnOf(columns: ChartColumn[], anchor: SetupAnchor | null): number {
  if (!anchor) return -1;
  return anchor.kind === "event"
    ? columns.findIndex((column) => column.event.id === anchor.id)
    : columns.findIndex((column) => column.event.chapterId === anchor.id);
}

interface SetupRow {
  setup: Setup;
  planted: number;
  /** Paid off here, or planned to be; -1 if neither is on the chart. */
  payoff: number;
}

export function TimelineChart({ columns, entities, threads, setups, language, orderLabel, onOpen }: {
  columns: ChartColumn[];
  entities: Entity[];
  threads: Thread[];
  setups: Setup[];
  language: string;
  orderLabel: string;
  onOpen: (event: StoryEvent) => void;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ChartRows>(storedRows);

  function choose(next: ChartRows) {
    setRows(next);
    try {
      window.localStorage.setItem(ROWS_KEY, next);
    } catch {
      // Remembering the choice is a convenience only.
    }
  }

  const sources: Record<ChartRows, Array<{ id: string; name: string }>> = {
    people: entities.filter((entity) => entity.type === "character"),
    threads,
    places: entities.filter((entity) => entity.type === "location")
  };
  const takesPart: Record<ChartRows, (event: StoryEvent, id: string) => boolean> = {
    people: (event, id) => event.participantIds.includes(id),
    threads: (event, id) => event.threadIds.includes(id),
    places: (event, id) => event.locationId === id
  };
  // Only rows with at least one event: an empty lane says nothing.
  const lanes: Row[] = sources[rows]
    .map((source) => ({ id: source.id, name: source.name, hits: columns.map((column) => takesPart[rows](column.event, source.id)) }))
    .filter((row) => row.hits.some(Boolean));
  // Setup lines run under every kind of row (mockup Fig. 2).
  const planted = setups.filter((setup) => setup.plantedIn && setup.status !== "dropped");
  const setupRows: SetupRow[] = planted
    .map((setup) => ({ setup, planted: columnOf(columns, setup.plantedIn), payoff: columnOf(columns, setup.paidOffIn) }))
    .filter((row) => row.planted >= 0);
  const offChart = planted.length - setupRows.length;

  return (
    <section className="card tl-chart-card" aria-label={t("timeline.chart.label")} data-testid="timeline-chart" data-rows={rows}>
      <div className="tl-chart-head">
        <div>
          <span className="caps">{t("timeline.chart.figure")}</span>{" "}
          <span className="muted tl-chart-caption">{t("timeline.chart.caption", { order: orderLabel })}</span>
        </div>
        <div className="cast-views" role="group" aria-label={t("timeline.chart.rowsLabel")}>
          {(["people", "threads", "places"] as const).map((item) => (
            <button key={item} type="button" className={rows === item ? "btn on" : "btn"} aria-pressed={rows === item} onClick={() => choose(item)} data-testid={`chart-rows-${item}`}>
              {t(`timeline.chart.rows.${item}`)}
            </button>
          ))}
        </div>
      </div>

      {columns.length && lanes.length === 0 ? <p className="muted tl-chart-empty" data-testid="chart-empty">{t(`timeline.chart.empty.${rows}`)}</p> : null}
      {columns.length === 0 ? <p className="muted tl-chart-empty" data-testid="chart-empty">{t("timeline.chart.noEvents")}</p> : null}
      {columns.length === 0 || (lanes.length === 0 && setupRows.length === 0) ? null : (
        <div className="tl-chart-scroll">
          <table className="tl-chart" style={{ minWidth: 140 + columns.length * 96 }}>
            <thead>
              <tr>
                <td />
                {columns.map((column, index) => (
                  <th key={column.event.id} scope="col">
                    <button type="button" className="tl-col" title={column.event.title} onClick={() => onOpen(column.event)} data-testid="chart-column" lang={language}>
                      <span className="tl-col-num" aria-hidden="true">{numeral(index)}</span>
                      <span className="caps tl-col-head">{column.head}</span>
                      <span className={column.flashback ? "tl-col-sub flashback" : "tl-col-sub"}>{column.sub}</span>
                      <span className="visually-hidden">{column.event.title}</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lanes.map((lane) => {
                const first = lane.hits.indexOf(true);
                const last = lane.hits.lastIndexOf(true);
                return (
                  <tr key={lane.id} data-testid="chart-row" data-row-id={lane.id}>
                    <th scope="row" className="tl-row-name" lang={language}>{lane.name}</th>
                    {lane.hits.map((hit, index) => {
                      const classes = ["tl-cell"];
                      if (index > first && index <= last) classes.push("in");
                      if (index >= first && index < last) classes.push("out");
                      return (
                        <td key={columns[index].event.id} className={classes.join(" ")} data-hit={hit}>
                          {hit ? (
                            <>
                              <span className="tl-dot" aria-hidden="true" />
                              <span className="visually-hidden">{t("timeline.chart.takesPart")}</span>
                            </>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {setupRows.map(({ setup, planted: start, payoff }) => {
                const paid = setup.status === "paid" && payoff >= 0;
                // The line runs to the payoff, or, while it waits, to the end of the chart.
                const end = payoff > start ? payoff : columns.length - 1;
                const waitingAt = setup.status === "open" ? (payoff > start ? payoff : columns.length - 1) : -1;
                return (
                  <tr key={setup.id} className="tl-setup-row" data-testid="chart-setup" data-setup-id={setup.id} data-status={setup.status}>
                    <th scope="row" className="tl-row-name tl-setup-name" lang={language}>{setup.description}</th>
                    {columns.map((column, index) => {
                      const classes = ["tl-cell", "tl-setup-cell"];
                      if (index > start && index <= end) classes.push("in");
                      if (index >= start && index < end) classes.push("out");
                      const mark = index === start ? "planted" : paid && index === payoff ? "paid" : index === waitingAt ? "waiting" : "";
                      return (
                        <td key={column.event.id} className={classes.join(" ")} data-mark={mark || undefined}>
                          {mark ? (
                            <>
                              <span className={`tl-diamond ${mark}`} aria-hidden="true" />
                              <span className="visually-hidden">{t(`timeline.chart.setup.${mark}`)}</span>
                            </>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {offChart > 0 ? <p className="muted assist-hint" data-testid="chart-setups-off">{t("timeline.chart.setupsOff", { count: offChart })}</p> : null}
    </section>
  );
}
