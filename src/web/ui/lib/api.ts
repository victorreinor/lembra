import type {
  FacetsResponse,
  FilesResponse,
  PendingResponse,
  SearchResponse,
  SessionDetailResponse,
  StatsResponse,
} from "../../types";
import { locale } from "./i18n";

// Typed client for src/web/api.ts. Every call sends x-lembra (required for writes) and the page's language,
// so server-made text (errors, handoff, pending reasons) matches the page.

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { "x-lembra": "1", "accept-language": locale };
  if (init.body) headers["content-type"] = "application/json";
  const res = await fetch(path, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Erro ${res.status}`);
  return body as T;
}

const query = (params: Record<string, string | boolean | number | undefined>) =>
  new URLSearchParams(
    Object.entries(params).flatMap(([key, value]) => (value === undefined || value === "" || value === false ? [] : [[key, value === true ? "1" : String(value)]])),
  ).toString();

export interface ListParams {
  q?: string;
  repo?: string;
  branch?: string;
  since?: string;
  prompts?: boolean;
}

export const api = {
  health: () => request<{ app: string; version: string; lang: string | null }>("/api/health"),
  search: (params: ListParams, signal?: AbortSignal) => request<SearchResponse>(`/api/search?${query({ ...params })}`, { signal }),
  session: (id: string, replies = false) => request<SessionDetailResponse>(`/api/sessions/${encodeURIComponent(id)}?${query({ replies })}`),
  handoff: (id: string) => request<{ text: string }>(`/api/sessions/${encodeURIComponent(id)}/handoff`),
  openTerminal: (id: string) => request<{ ok: true }>(`/api/sessions/${encodeURIComponent(id)}/terminal`, { method: "POST" }),
  files: (params: { term?: string; repo?: string; since?: string; missing?: boolean }, signal?: AbortSignal) =>
    request<FilesResponse>(`/api/files?${query({ ...params, limit: 200 })}`, { signal }),
  restore: (id: number, body: { to?: string; force?: boolean } = {}) =>
    request<{ dest: string; displayDest: string }>(`/api/files/${id}/restore`, { method: "POST", body: JSON.stringify(body) }),
  rawUrl: (id: number, download = false) => `/api/files/${id}/raw${download ? "?download=1" : ""}`,
  facets: () => request<FacetsResponse>("/api/facets"),
  stats: () => request<StatsResponse>("/api/stats"),
  pending: (since: string, signal?: AbortSignal) => request<PendingResponse>(`/api/pending?${query({ since })}`, { signal }),
};
