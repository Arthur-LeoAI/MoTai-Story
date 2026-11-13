import { ApiError, request } from "./api";

export const WRITE_MODES = ["continue", "expand", "shorten", "polish", "custom"] as const;
export type WriteMode = (typeof WRITE_MODES)[number];
/** Modes that rewrite the selected text; "continue" adds after the cursor or at the end. */
export const NEEDS_SELECTION: readonly WriteMode[] = ["expand", "shorten", "polish"];

export interface Hunk {
  id: string;
  index: number;
  length: number;
  before: string;
  after: string;
}

export interface Conflict {
  id: string;
  severity: "hard" | "soft";
  status: "open" | "resolved" | "dismissed";
  kind: "" | "contradiction" | "confirmation" | "suggestion";
  message: string;
  evidence: Array<{ excerpt: string }>;
}

export interface Generation {
  id: string;
  status: string;
  provider: string;
  model: string;
  rewriteCount: number;
  hunks?: Hunk[];
  conflicts: Conflict[];
  context: { canonFactIds: string[]; chapterMemoryChapterIds: string[] };
}

export interface GenerationResult {
  text: string;
  canAccept: boolean;
  generation: Generation;
}

export interface Task {
  id: string;
  status: "queued" | "generating" | "checking" | "completed" | "failed" | "cancelled" | "interrupted";
  result?: GenerationResult;
  errorCode?: string;
  errorParams?: Record<string, unknown>;
  errorStatus?: number;
  message?: string;
}

export interface CanonFact {
  id: string;
  category: string;
  predicate: string;
  value: string;
}

export interface CanonProposal {
  id: string;
  chapterId: string;
  status: "pending" | "accepted" | "rejected";
  changes: Array<{ operation: string; fact: CanonFact }>;
}

export interface Range {
  index: number;
  length: number;
}

const workBase = (workId: string) => `/api/works/${encodeURIComponent(workId)}`;
const post = (data: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(data) });
const TERMINAL = new Set(["completed", "failed", "cancelled", "interrupted"]);

export const assistApi = {
  start: (input: {
    workId: string;
    chapterId: string;
    baseRevision: number;
    mode: WriteMode;
    instruction: string;
    selectedText: string;
    range: Range;
  }) => request<{ task: Task }>("/api/tasks", post({ ...input, requestId: crypto.randomUUID(), autoRewrite: true })),
  cancel: (taskId: string) => request<{ task: Task }>(`/api/tasks/${encodeURIComponent(taskId)}/cancel`, post({})),
  task: (taskId: string) => request<{ task: Task }>(`/api/tasks/${encodeURIComponent(taskId)}`),
  merge: (workId: string, chapterId: string, generationId: string, baseRevision: number, hunkIds: string[]) =>
    request<{ chapter: { revision: number }; reviewTask?: Task }>(
      `${workBase(workId)}/chapters/${encodeURIComponent(chapterId)}/generations/${encodeURIComponent(generationId)}/merge`,
      post({ baseRevision, hunkIds })
    ),
  adjudicate: (workId: string, chapterId: string, generationId: string, body: { conflictId: string; reason: string; baseRevision: number; canonRevision: number }) =>
    request<{ generation: Generation; canAccept: boolean }>(
      `${workBase(workId)}/chapters/${encodeURIComponent(chapterId)}/generations/${encodeURIComponent(generationId)}/adjudicate`,
      post(body)
    ),
  review: (workId: string, chapterId: string, baseRevision: number) =>
    request<{ proposal?: CanonProposal }>(`${workBase(workId)}/chapters/${encodeURIComponent(chapterId)}/review`, post({ baseRevision, requestId: crypto.randomUUID() })),
  proposals: async (workId: string) =>
    ((await request<{ work: { canonProposals?: CanonProposal[] } }>(workBase(workId))).work.canonProposals ?? []),
  confirmFacts: (workId: string, proposalId: string, factIds: string[]) =>
    request<{ proposal: CanonProposal }>(`${workBase(workId)}/canon-proposals/${encodeURIComponent(proposalId)}/confirm`, post({ factIds })),
  rejectFacts: (workId: string, proposalId: string) =>
    request<{ proposal: CanonProposal }>(`${workBase(workId)}/canon-proposals/${encodeURIComponent(proposalId)}/reject`, post({}))
};

/**
 * Follows a background task until it ends, reporting each state. Uses the
 * server's event stream and falls back to polling if the stream drops.
 */
export function followTask(task: Task, onUpdate: (task: Task) => void, signal: AbortSignal): Promise<GenerationResult> {
  return new Promise((resolve, reject) => {
    let source: EventSource | null = null;
    let timer: number | undefined;
    let done = false;
    const finish = (current: Task) => {
      if (done) return;
      onUpdate(current);
      if (!TERMINAL.has(current.status)) return;
      done = true;
      source?.close();
      window.clearInterval(timer);
      if (current.status === "completed" && current.result) resolve(current.result);
      else reject(new ApiError(current.errorStatus ?? 409, current.errorCode ?? (current.status === "cancelled" ? "TASK_CANCELLED" : "TASK_NOT_COMPLETED"), current.message ?? "", current.errorParams ?? {}));
    };
    signal.addEventListener("abort", () => {
      if (done) return;
      done = true;
      source?.close();
      window.clearInterval(timer);
      reject(new ApiError(499, "GENERATION_STOPPED", "Stopped"));
    });
    if (TERMINAL.has(task.status)) {
      finish(task);
      return;
    }
    onUpdate(task);
    const poll = () => {
      if (timer) return;
      timer = window.setInterval(() => {
        assistApi.task(task.id).then(({ task: current }) => finish(current)).catch(() => undefined);
      }, 1500);
    };
    source = new EventSource(`/api/tasks/${encodeURIComponent(task.id)}/events`);
    source.addEventListener("task", (event) => finish(JSON.parse((event as MessageEvent).data)));
    source.onerror = () => {
      source?.close();
      if (!done) poll();
    };
  });
}
