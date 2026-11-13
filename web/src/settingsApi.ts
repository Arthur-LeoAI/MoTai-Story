import { request } from "./api";

export interface ProviderStatus {
  provider: string;
  label: string;
  hasApiKey: boolean;
  available?: boolean;
  model?: string;
  message?: string;
  code?: string;
  params?: Record<string, unknown>;
  checkedAt?: string;
}

export interface AiConfig {
  provider: string;
  providerLabel: string;
  model: string;
  configured: boolean;
  /** "test" when the server runs with the built-in test AI. */
  statusProvider: string;
  providerStatuses: ProviderStatus[];
}

export interface ModelChoice {
  provider: string;
  providerLabel: string;
  id: string;
}

export interface ConnectionResult {
  ok: boolean;
  provider: string;
  model: string;
  code?: string;
  params?: Record<string, unknown>;
  message?: string;
}

export interface Usage {
  totalTokens: number;
  dailyTokenLimit: number;
  unknownCalls: number;
  entries: unknown[];
}

export interface TaskSummary {
  id: string;
  workId: string;
  status: string;
  createdAt: string;
  errorCode?: string;
  errorParams?: Record<string, unknown>;
  message?: string;
  input?: { mode?: string; kind?: string };
}

export interface BackupStatus {
  intervalHours: number;
  retention: number;
  count: number;
  lastBackup: { name: string; createdAt: string } | null;
}

const post = (data: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(data) });

export const settingsApi = {
  config: () => request<{ config: AiConfig }>("/api/ai/config"),
  models: () => request<{ models: ModelChoice[]; errors: Array<{ provider: string; errorCode?: string; errorParams?: Record<string, unknown> }> }>("/api/ai/models"),
  /** Chooses the writing model. API keys are never sent from here; the server's environment holds them. */
  chooseModel: (provider: string, model: string) => request<{ config: AiConfig }>("/api/ai/config", post({ provider, model })),
  test: (provider?: string) => request<ConnectionResult>("/api/ai/test", post(provider ? { provider } : {})),
  usage: () => request<Usage>("/api/usage"),
  tasks: () => request<{ tasks: TaskSummary[] }>("/api/tasks"),
  backupStatus: () => request<{ automatic: BackupStatus }>("/api/backup/status"),
  restore: (backup: unknown) => request<{ ok: boolean }>("/api/backup/restore", post(backup))
};
