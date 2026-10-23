// Shapes exchanged between the local API (src/web/api.ts) and the page (src/web/ui). Type-only on the client.

import type { FileStatus, StoredFile } from "../core/files";
import type { Snippet } from "../core/search";
import type { Facet, SessionMessage } from "../core/sessions";
import type { LembraStats } from "../core/stats";

export type { Facet, SessionMessage };

export interface SessionDTO {
  id: string;
  // null until Claude Code names the session; the page shows t.sessions.untitled.
  title: string | null;
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

export interface ResultDTO {
  session: SessionDTO;
  // Matches wrapped in \x01…\x02.
  snippets: Snippet[];
}

export interface SearchResponse {
  mode: "search" | "recent";
  results: ResultDTO[];
  tookMs: number;
}

export interface FileDTO {
  id: number;
  path: string;
  displayPath: string;
  kind: StoredFile["kind"];
  ts: string;
  size: number | null;
  repoName: string;
  sessionId: string;
  versions: number;
  status: FileStatus;
  secrets: number;
}

export interface SessionDetailResponse {
  session: SessionDTO;
  messages: SessionMessage[];
  files: FileDTO[];
}

export interface FilesResponse {
  files: FileDTO[];
  total: number;
}

export interface FacetsResponse {
  // label: the repository's short name, as shown everywhere else.
  repos: (Facet & { label: string })[];
  branches: Facet[];
}

export type StatsResponse = LembraStats & { indexedAt: string | null; version: string };

export interface PendingDTO {
  repoName: string;
  branch: string;
  reasons: string[];
  sessions: number;
  lastSession: SessionDTO;
}

export interface PendingResponse {
  // The period actually analyzed (the server's default when none was asked).
  since: string;
  items: PendingDTO[];
}
