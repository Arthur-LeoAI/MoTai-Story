import { ApiError, request } from "./api";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "complete" | "interrupted";
  createdAt: string;
}

export interface Chat {
  id: string;
  title: string;
  /** True while nobody has named the conversation; show a translated placeholder instead of `title`. */
  untitled: boolean;
  updatedAt: string;
  messages: ChatMessage[];
}

export const ARTIFACT_TYPES = ["outline", "characters", "world", "timeline"] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

/** Which story-material fields belong to each kind of draft (mirrors src/studio.js). */
export const ARTIFACT_FIELDS: Record<ArtifactType, readonly string[]> = {
  outline: ["logline", "theme", "tone", "genrePositioning", "conflict", "antagonistPressure", "outline", "chapterPlan"],
  characters: ["characters", "relationships"],
  world: ["worldview", "rules", "era", "factions", "locations"],
  timeline: ["keyEvents", "foreshadowing", "continuityNotes"]
};

export interface Proposal {
  id: string;
  chatId: string;
  sourceMessageId: string;
  type: ArtifactType;
  status: "pending" | "applied" | "discarded" | "reverted";
  createdAt: string;
  /** Only `key`, `before` and `after` are used; labels are translated in the interface. */
  sections: Array<{ key: string; before: string; after: string }>;
  previousValues: Record<string, string>;
}

export type StoryMaterial = Record<string, string>;

const base = (workId: string) => `/api/works/${encodeURIComponent(workId)}`;
const json = (data: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(data) });

export const ideateApi = {
  load: (workId: string) =>
    request<{ activeChatId: string; chats: Chat[]; proposals: Proposal[] }>(`${base(workId)}/chats`),
  createChat: (workId: string) => request<{ chat: Chat }>(`${base(workId)}/chats`, json({})),
  /** Marks the chat as the active one; with a title, also renames it. */
  touchChat: (workId: string, chatId: string, title?: string) =>
    request<{ chat: Chat }>(`${base(workId)}/chats/${encodeURIComponent(chatId)}`, {
      method: "PATCH",
      body: JSON.stringify(title === undefined ? {} : { title })
    }),
  deleteChat: (workId: string, chatId: string) =>
    request<{ activeChatId: string; chats: Chat[] }>(`${base(workId)}/chats/${encodeURIComponent(chatId)}`, { method: "DELETE" }),
  draft: (workId: string, chatId: string, type: ArtifactType, sourceMessageId: string) =>
    request<{ proposal: Proposal }>(`${base(workId)}/chats/${encodeURIComponent(chatId)}/proposals`, json({ type, sourceMessageId })),
  keep: (workId: string, proposalId: string, sectionKeys: string[]) =>
    request<{ proposal: Proposal; storyBible: StoryMaterial }>(`${base(workId)}/proposals/${encodeURIComponent(proposalId)}/apply`, json({ sectionKeys })),
  undo: (workId: string, proposalId: string) =>
    request<{ proposal: Proposal; storyBible: StoryMaterial }>(`${base(workId)}/proposals/${encodeURIComponent(proposalId)}/revert`, json({})),
  discard: (workId: string, proposalId: string) =>
    request<{ proposal: Proposal }>(`${base(workId)}/proposals/${encodeURIComponent(proposalId)}`, { method: "PATCH", body: "{}" })
};

export interface StreamHandlers {
  onMeta: (meta: { userMessageId: string; assistantMessageId: string; chatTitle: string }) => void;
  onDelta: (text: string) => void;
  onDone: (message: ChatMessage) => void;
}

/**
 * Sends a message and reads the reply as it is written (server-sent events
 * over a POST response). Rejects with ApiError; when the reply was cut short,
 * `partial` on the error carries what had arrived.
 */
export async function streamMessage(
  workId: string,
  chatId: string,
  content: string,
  handlers: StreamHandlers,
  signal: AbortSignal
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${base(workId)}/chats/${encodeURIComponent(chatId)}/messages/stream`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content })
    });
  } catch (cause) {
    if (signal.aborted) throw new StreamError(499, "GENERATION_STOPPED", "Stopped");
    throw new StreamError(0, "NETWORK_UNREACHABLE", cause instanceof Error ? cause.message : "Network error");
  }
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => ({}));
    const error = body?.error ?? {};
    throw new StreamError(response.status, error.code ?? "INTERNAL_ERROR", error.message ?? `HTTP ${response.status}`, error.params ?? {});
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  const handle = (block: string) => {
    let event = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!data) return;
    const payload = JSON.parse(data);
    if (event === "meta") handlers.onMeta(payload);
    else if (event === "delta") handlers.onDelta(payload.text ?? "");
    else if (event === "done") {
      finished = true;
      handlers.onDone(payload.message);
    } else if (event === "error") {
      finished = true;
      throw new StreamError(payload.status ?? 502, payload.code ?? "AI_UPSTREAM_ERROR", payload.message ?? "", payload.params ?? {}, payload.partialMessage ?? null);
    }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end = buffer.indexOf("\n\n");
      while (end >= 0) {
        handle(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        end = buffer.indexOf("\n\n");
      }
    }
  } catch (cause) {
    if (cause instanceof StreamError) throw cause;
    if (signal.aborted) throw new StreamError(499, "GENERATION_STOPPED", "Stopped");
    throw new StreamError(0, "NETWORK_UNREACHABLE", cause instanceof Error ? cause.message : "Network error");
  }
  if (!finished) throw new StreamError(signal.aborted ? 499 : 502, signal.aborted ? "GENERATION_STOPPED" : "AI_UPSTREAM_ERROR", "", { detail: "" });
}

export class StreamError extends ApiError {
  readonly partial: ChatMessage | null;

  constructor(status: number, code: string, message: string, params: Record<string, unknown> = {}, partial: ChatMessage | null = null) {
    super(status, code, message, params);
    this.partial = partial;
  }

  get stopped(): boolean {
    return this.code === "GENERATION_STOPPED";
  }
}
