import { request } from "./api";

// Structured story objects (data model v6, docs/DATA_MODEL_V6.md). Only what
// the Cast page uses so far.

export const CARD_TYPES = ["character", "location", "faction", "item", "rule"] as const;
export type CardType = (typeof CARD_TYPES)[number];

/** The questions of a character card: the first three are always shown, the rest under "More". */
export const CHARACTER_MAIN_FIELDS = ["want", "obstacle", "change"] as const;
export const CHARACTER_MORE_FIELDS = ["appearance", "voice", "secret", "background"] as const;
export type CharacterField = (typeof CHARACTER_MAIN_FIELDS)[number] | (typeof CHARACTER_MORE_FIELDS)[number];

export interface Entity {
  id: string;
  type: CardType | "event" | "foreshadowing";
  name: string;
  aliases: string[];
  summary: string;
  card: Partial<Record<CharacterField | string, string>>;
  notes: string;
  image: string;
  color: string;
  /** Optimistic-lock version of this card: every change sends the revision it was based on. */
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface Canon {
  entities: Entity[];
  canonRevision: number;
}

/** The fields a writer edits on a card. Empty strings clear a field. */
export interface EntityDraft {
  name: string;
  aliases: string[];
  summary: string;
  card: Record<string, string>;
  notes: string;
}

const base = (workId: string) => `/api/works/${encodeURIComponent(workId)}/canon`;
const entityPath = (workId: string, entityId: string) => `${base(workId)}/entities/${encodeURIComponent(entityId)}`;
const send = (method: string, data: unknown): RequestInit => ({ method, body: JSON.stringify(data) });

export const castApi = {
  canon: (workId: string) => request<{ canon: Canon }>(base(workId)),
  create: (workId: string, type: CardType, draft: EntityDraft) =>
    request<{ item: Entity; canonRevision: number }>(`${base(workId)}/entities`, send("POST", { type, ...draft })),
  update: (workId: string, entity: Entity, draft: EntityDraft) =>
    request<{ item: Entity; canonRevision: number }>(entityPath(workId, entity.id), send("PATCH", { ...draft, baseRevision: entity.revision })),
  remove: (workId: string, entity: Entity) =>
    request<{ removed: { id: string; relationIds: string[] }; canonRevision: number }>(entityPath(workId, entity.id), send("DELETE", { baseRevision: entity.revision }))
};

/** Aliases typed as one line: commas in either language, or the Chinese enumeration comma. */
export function parseAliases(value: string): string[] {
  return [...new Set(value.split(/[,，、;；]/).map((item) => item.trim()).filter(Boolean))];
}
