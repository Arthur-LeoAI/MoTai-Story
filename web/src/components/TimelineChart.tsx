import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Entity, StoryEvent, Thread } from "../castApi";
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

export function TimelineChart({ columns, entities, threads, language, orderLabel, onOpen }: {
  columns: ChartColumn[];
  entities: Entity[];
  threads: Thread[];
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

      {columns.length === 0 || lanes.length === 0 ? (
        <p className="muted tl-chart-empty" data-testid="chart-empty">{columns.length === 0 ? t("timeline.chart.noEvents") : t(`timeline.chart.empty.${rows}`)}</p>
      ) : (
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
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
