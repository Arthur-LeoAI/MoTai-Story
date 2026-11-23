import { request } from "./api";

// Writing styles (plan 5.9.1): built-in cards for each story language, and
// the writer's own. A style changes how a passage is told, never what happens.

export interface WritingStyle {
  id: string;
  language: "en" | "zh-CN";
  name: string;
  description: string;
  guidance: string;
  samples: string[];
  source: "builtin" | "user" | "imported";
  revision: number;
  updatedAt: string;
}

/** The editable part of a style card. */
export interface StyleDraft {
  language: "en" | "zh-CN";
  name: string;
  description: string;
  guidance: string;
  samples: string[];
}

const send = (method: string, data: unknown): RequestInit => ({ method, body: JSON.stringify(data) });
const storyStyle = (workId: string) => `/api/works/${encodeURIComponent(workId)}/style`;

export const stylesApi = {
  list: (language: string) => request<{ styles: WritingStyle[] }>(`/api/styles?language=${encodeURIComponent(language)}`),
  storyStyle: (workId: string) => request<{ styleId: string }>(storyStyle(workId)),
  setStoryStyle: (workId: string, styleId: string) => request<{ styleId: string }>(storyStyle(workId), { method: "PUT", body: JSON.stringify({ styleId }) }),
  /** The writer's own styles, in every language. */
  mine: () => request<{ styles: WritingStyle[] }>("/api/me/styles"),
  create: (draft: StyleDraft, source: "user" | "imported" = "user") => request<{ style: WritingStyle }>("/api/me/styles", send("POST", { ...draft, source })),
  update: (style: WritingStyle, draft: StyleDraft) => request<{ style: WritingStyle }>(`/api/me/styles/${encodeURIComponent(style.id)}`, send("PUT", { ...draft, baseRevision: style.revision })),
  remove: (style: WritingStyle) => request<{ removed: { id: string } }>(`/api/me/styles/${encodeURIComponent(style.id)}`, send("DELETE", { baseRevision: style.revision })),
  /** An AI draft of a card from a few words or a passage; nothing is saved. */
  draft: (input: { language: string; description?: string; passage?: string }) => request<{ draft: StyleDraft }>("/api/me/styles/draft", send("POST", input))
};
