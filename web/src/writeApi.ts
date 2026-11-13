import { request } from "./api";
import type { StoryLanguage } from "./api";

/** Quill Delta as stored by the server (`richContent`). */
export interface RichContent {
  version?: number;
  ops: Array<{ insert: unknown; attributes?: Record<string, unknown> }>;
}

export interface Chapter {
  id: string;
  title: string;
  content: string;
  richContent: RichContent;
  status: string;
  /** Optimistic-lock version: every save sends the revision it was based on. */
  revision: number;
  updatedAt: string;
  deletedAt?: string;
}

export interface Work {
  id: string;
  title: string;
  language: StoryLanguage;
  /** Version of the chapter list (order, add, delete, restore). */
  structureRevision: number;
  canonRevision: number;
  chapters: Chapter[];
  deletedChapters?: Chapter[];
}

const base = (workId: string) => `/api/works/${encodeURIComponent(workId)}`;
const chapterPath = (workId: string, chapterId: string) => `${base(workId)}/chapters/${encodeURIComponent(chapterId)}`;
const send = (method: string, data: unknown): RequestInit => ({ method, body: JSON.stringify(data) });

export const writeApi = {
  work: (workId: string) => request<{ work: Work }>(base(workId)),
  addChapter: (workId: string) => request<{ chapter: Chapter; work: Work }>(`${base(workId)}/chapters`, send("POST", {})),
  saveChapter: (workId: string, chapterId: string, baseRevision: number, change: { title?: string; richContent?: RichContent }) =>
    request<{ chapter: Chapter; work: Work }>(chapterPath(workId, chapterId), send("PATCH", { ...change, baseRevision })),
  deleteChapter: (workId: string, chapter: Chapter) =>
    request<{ work: Work }>(chapterPath(workId, chapter.id), send("DELETE", { baseRevision: chapter.revision })),
  trash: (workId: string) => request<{ chapters: Chapter[] }>(`${base(workId)}/trash`),
  restoreChapter: (workId: string, chapterId: string, structureRevision: number) =>
    request<{ work: Work }>(`${base(workId)}/trash/${encodeURIComponent(chapterId)}/restore`, send("POST", { baseRevision: structureRevision })),
  reorder: (workId: string, chapterIds: string[], structureRevision: number) =>
    request<{ work: Work }>(`${base(workId)}/plan`, send("PATCH", { chapterIds, baseRevision: structureRevision }))
};

/** Length in the unit readers of the story's language expect: words for English, characters for Chinese. */
export function manuscriptLength(text: string, language: StoryLanguage): number {
  if (language === "en") {
    const trimmed = text.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }
  return text.replace(/\s/g, "").length;
}
