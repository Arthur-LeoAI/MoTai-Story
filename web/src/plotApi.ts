import { request } from "./api";

// The story spine (plan 5.8): six sentences that carry the main line.
// "Because of that" may hold several sentences.

export const SPINE_LINES = ["once", "everyDay", "oneDay", "because", "finally", "everSince"] as const;
export type SpineLine = (typeof SPINE_LINES)[number];
export const MAX_BECAUSE = 8;

export interface SpineLines {
  once: string;
  everyDay: string;
  oneDay: string;
  because: string[];
  finally: string;
  everSince: string;
}

export interface Spine extends SpineLines {
  revision: number;
  updatedAt: string;
}

const base = (workId: string) => `/api/works/${encodeURIComponent(workId)}/spine`;

export const plotApi = {
  spine: (workId: string) => request<{ spine: Spine }>(base(workId)),
  /** Saves the sentences against the revision they were read at. */
  saveSpine: (workId: string, lines: SpineLines, baseRevision: number) =>
    request<{ spine: Spine }>(base(workId), { method: "PUT", body: JSON.stringify({ lines, baseRevision }) }),
  /** AI suggestions for one sentence, from the saved spine; nothing is saved. */
  suggest: (workId: string, line: SpineLine, index?: number) =>
    request<{ suggestions: string[] }>(`${base(workId)}/suggestions`, { method: "POST", body: JSON.stringify({ line, index }) })
};
