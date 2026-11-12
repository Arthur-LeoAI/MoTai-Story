import type { TFunction } from "i18next";
import type { Theme } from "./theme";
import type { UiLocale } from "./i18n";

// Errors from the server arrive as { error: { code, message, params } }.
// The UI shows t(`errors.${code}`); `message` is only an English fallback.
export class ApiError extends Error {
  readonly code: string;
  readonly params: Record<string, unknown>;
  readonly status: number;

  constructor(status: number, code: string, message: string, params: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.params = params;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init.headers } });
  } catch (cause) {
    throw new ApiError(0, "NETWORK_UNREACHABLE", cause instanceof Error ? cause.message : "Network error");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = body?.error ?? {};
    throw new ApiError(response.status, error.code ?? "INTERNAL_ERROR", error.message ?? `HTTP ${response.status}`, error.params ?? {});
  }
  return body as T;
}

export function errorText(t: TFunction, error: unknown): string {
  if (error instanceof ApiError) {
    return t(`errors.${error.code}`, { ...error.params, defaultValue: error.message });
  }
  return t("errors.INTERNAL_ERROR");
}

export interface Preferences {
  uiLocale: UiLocale;
  theme: Theme;
  updatedAt: string | null;
}

export interface Session {
  user: { id: string; kind: string; displayName: string };
  brand: { codename: string };
  preferences: Preferences;
}

export const api = {
  session: () => request<Session>("/api/session"),
  updatePreferences: (patch: Partial<Pick<Preferences, "uiLocale" | "theme">>) =>
    request<{ preferences: Preferences }>("/api/me/preferences", { method: "PATCH", body: JSON.stringify(patch) })
};
