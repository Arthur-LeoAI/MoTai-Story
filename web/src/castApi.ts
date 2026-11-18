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

export const RELATION_KINDS = ["family", "friend", "lover", "mentor", "rival", "enemy", "ally", "custom"] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

/** How two entities stand to each other. "mentor" reads from → to; the other kinds go both ways. */
export interface Relation {
  id: string;
  fromId: string;
  toId: string;
  kind: RelationKind;
  label: string;
  tension: string;
  /** Story time, half-open [storyFrom, storyUntil); null = not placed in time. */
  storyFrom: number | null;
  storyUntil: number | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface RelationDraft {
  fromId: string;
  toId: string;
  kind: RelationKind;
  label: string;
  tension: string;
}

/** Something that happens: its place in story time (storyOrder) and the chapter that tells it (reader order). */
export interface StoryEvent {
  id: string;
  title: string;
  summary: string;
  storyOrder: number;
  /** The writer's own words for when it happens ("three years earlier"). */
  timeLabel: string;
  /** The chapter that tells it; empty while it is not told yet. */
  chapterId: string;
  participantIds: string[];
  locationId: string;
  threadIds: string[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface EventDraft {
  title: string;
  summary: string;
  timeLabel: string;
  chapterId: string;
  participantIds: string[];
  locationId: string;
  threadIds: string[];
}

/** A plot line events belong to ("Finding the sister", "The love story"). */
export interface Thread {
  id: string;
  name: string;
  color: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface Canon {
  entities: Entity[];
  relations: Relation[];
  events: StoryEvent[];
  threads: Thread[];
  setups: Setup[];
  canonRevision: number;
}

/** Where a setup is planted or paid off: a chapter, or an event. */
export interface SetupAnchor {
  kind: "chapter" | "event";
  id: string;
}

/** Foreshadowing: something planted early that should pay off later. */
export interface Setup {
  id: string;
  description: string;
  plantedIn: SetupAnchor | null;
  paidOffIn: SetupAnchor | null;
  status: "open" | "paid" | "dropped";
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface SetupDraft {
  description: string;
  plantedIn: SetupAnchor | null;
  paidOffIn: SetupAnchor | null;
  status: Setup["status"];
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
const relationPath = (workId: string, relationId: string) => `${base(workId)}/relations/${encodeURIComponent(relationId)}`;
const send = (method: string, data: unknown): RequestInit => ({ method, body: JSON.stringify(data) });

export const castApi = {
  canon: (workId: string) => request<{ canon: Canon }>(base(workId)),
  create: (workId: string, type: CardType, draft: EntityDraft) =>
    request<{ item: Entity; canonRevision: number }>(`${base(workId)}/entities`, send("POST", { type, ...draft })),
  update: (workId: string, entity: Entity, draft: EntityDraft) =>
    request<{ item: Entity; canonRevision: number }>(entityPath(workId, entity.id), send("PATCH", { ...draft, baseRevision: entity.revision })),
  remove: (workId: string, entity: Entity) =>
    request<{ removed: { id: string; relationIds: string[] }; canonRevision: number }>(entityPath(workId, entity.id), send("DELETE", { baseRevision: entity.revision })),
  createRelation: (workId: string, draft: RelationDraft) =>
    request<{ item: Relation; canonRevision: number }>(`${base(workId)}/relations`, send("POST", draft)),
  updateRelation: (workId: string, relation: Relation, draft: RelationDraft) =>
    request<{ item: Relation; canonRevision: number }>(relationPath(workId, relation.id), send("PATCH", { ...draft, baseRevision: relation.revision })),
  /** An AI draft of a character from a sentence; nothing is saved. With a chat message, that exchange is used too. */
  sketchCharacter: (workId: string, input: { description: string; chatId?: string; messageId?: string }) =>
    request<{ draft: EntityDraft }>(`${base(workId)}/drafts/character`, send("POST", input)),
  /** People named in a chat exchange who are not in the Cast yet. */
  castCandidates: (workId: string, chatId: string, messageId: string) =>
    request<{ candidates: Array<{ name: string; summary: string }> }>(
      `/api/works/${encodeURIComponent(workId)}/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/cast-candidates`,
      send("POST", {})
    ),
  /** Starts reading the manuscript for people, relationships and events (a background task). */
  extractManuscript: (workId: string) =>
    request<{ task: ExtractTask }>(`${base(workId)}/drafts/manuscript`, send("POST", { requestId: crypto.randomUUID() })),
  task: (taskId: string) => request<{ task: ExtractTask }>(`/api/tasks/${encodeURIComponent(taskId)}`),
  cancelTask: (taskId: string) => request<{ task: ExtractTask }>(`/api/tasks/${encodeURIComponent(taskId)}/cancel`, send("POST", {})),
  createEvent: (workId: string, event: Partial<EventDraft> & { title: string }) =>
    request<{ item: StoryEvent; canonRevision: number }>(`${base(workId)}/events`, send("POST", event)),
  updateEvent: (workId: string, event: StoryEvent, draft: EventDraft) =>
    request<{ item: StoryEvent; canonRevision: number }>(`${base(workId)}/events/${encodeURIComponent(event.id)}`, send("PATCH", { ...draft, baseRevision: event.revision })),
  removeEvent: (workId: string, event: StoryEvent) =>
    request<{ removed: { id: string }; canonRevision: number }>(`${base(workId)}/events/${encodeURIComponent(event.id)}`, send("DELETE", { baseRevision: event.revision })),
  createSetup: (workId: string, draft: SetupDraft) =>
    request<{ item: Setup; canonRevision: number }>(`${base(workId)}/setups`, send("POST", draft)),
  updateSetup: (workId: string, setup: Setup, draft: SetupDraft) =>
    request<{ item: Setup; canonRevision: number }>(`${base(workId)}/setups/${encodeURIComponent(setup.id)}`, send("PATCH", { ...draft, baseRevision: setup.revision })),
  removeSetup: (workId: string, setup: Setup) =>
    request<{ removed: { id: string }; canonRevision: number }>(`${base(workId)}/setups/${encodeURIComponent(setup.id)}`, send("DELETE", { baseRevision: setup.revision })),
  createThread: (workId: string, name: string) =>
    request<{ item: Thread; canonRevision: number }>(`${base(workId)}/threads`, send("POST", { name })),
  /** A new story order for all events, against the canon revision it was read at. */
  reorderEvents: (workId: string, eventIds: string[], canonRevision: number) =>
    request<{ events: StoryEvent[]; canonRevision: number }>(`${base(workId)}/events/order`, send("POST", { eventIds, canonRevision })),
  removeRelation: (workId: string, relation: Relation) =>
    request<{ removed: { id: string }; canonRevision: number }>(relationPath(workId, relation.id), send("DELETE", { baseRevision: relation.revision }))
};

/** Aliases typed as one line: commas in either language, or the Chinese enumeration comma. */
export function parseAliases(value: string): string[] {
  return [...new Set(value.split(/[,，、;；]/).map((item) => item.trim()).filter(Boolean))];
}

/** What reading the manuscript found: drafts only, nothing saved. Names refer to cards by their main name. */
export interface ManuscriptDrafts {
  characters: Array<{ name: string; aliases: string[]; summary: string; card: { want?: string }; chapterId: string }>;
  relations: Array<{ from: string; to: string; kind: RelationKind; label: string; tension: string }>;
  events: Array<{ chapterId: string; chapterTitle: string; title: string; summary: string; participants: string[]; location: string }>;
}

export interface ExtractTask {
  id: string;
  status: "queued" | "generating" | "checking" | "completed" | "failed" | "cancelled" | "interrupted";
  progress?: { done: number; total: number };
  result?: { drafts: ManuscriptDrafts; chaptersRead: number; chaptersWithText: number; shortened: string[] };
  errorCode?: string;
  errorParams?: Record<string, unknown>;
  errorStatus?: number;
  message?: string;
}
