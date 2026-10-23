// Shapes exchanged between the local API (src/web/api.ts) and the page (src/web/ui). Type-only on the client.

import type { Role } from "../core/transcript";

export type { Role };

export interface SessionDTO {
  id: string;
  title: string;
  repo: string | null;
  repoName: string;
  branch: string | null;
  cwd: string | null;
  startedAt: string | null;
  endedAt: string | null;
  promptCount: number;
  // "history": only prompts survived; the transcript was deleted before lembra existed.
  source: "transcript" | "history";
  costUsd: number | null;
  linesAdded: number | null;
  linesRemoved: number | null;
  digest: string | null;
  lastPrompt: string | null;
  resumeCommand: string | null;
}

export interface SnippetDTO {
  role: Role;
  ts: string;
  // Matches wrapped in \x01…\x02.
  text: string;
}

export interface ResultDTO {
  session: SessionDTO;
  snippets: SnippetDTO[];
}

export interface SearchResponse {
  mode: "search" | "recent";
  results: ResultDTO[];
  tookMs: number;
}

export type FileStatus = "disk" | "missing" | "image" | "partial";

export interface FileDTO {
  id: number;
  path: string;
  displayPath: string;
  kind: "write" | "edit" | "read" | "image" | "ref";
  ts: string;
  size: number | null;
  repoName: string;
  sessionId: string;
  versions: number;
  status: FileStatus;
}

export interface MessageDTO {
  role: Role;
  ts: string;
  text: string;
}

export interface SessionDetailResponse {
  session: SessionDTO;
  messages: MessageDTO[];
  files: FileDTO[];
}

export interface FilesResponse {
  files: FileDTO[];
  total: number;
}

export interface Facet {
  value: string;
  sessions: number;
}

export interface FacetsResponse {
  repos: Facet[];
  branches: Facet[];
}

export interface StatsResponse {
  sessions: number;
  historyOnly: number;
  oldest: string | null;
  prompts: number;
  missing: number;
  dbBytes: number;
  retentionDays: number | null;
  indexedAt: string | null;
  version: string;
}

export interface PendingDTO {
  repoName: string;
  branch: string;
  reasons: string[];
  sessions: number;
  lastSession: SessionDTO;
}

export interface PendingResponse {
  items: PendingDTO[];
}

export interface ErrorResponse {
  error: string;
}
