import type { Database } from "bun:sqlite";
import { LembraError } from "./errors";
import { filterSql, type FilterColumns, type Filters } from "./query";
import type { Role } from "./transcript";

export interface Session {
  pk: number;
  id: string;
  source: "transcript" | "history";
  cwd: string | null;
  repo: string | null;
  branch: string | null;
  ai_title: string | null;
  custom_title: string | null;
  title: string | null;
  first_prompt: string | null;
  last_prompt: string | null;
  prompt_count: number;
  started_at: string | null;
  ended_at: string | null;
  cost_usd: number | null;
  lines_added: number | null;
  lines_removed: number | null;
  digest: string | null;
  digest_at: string | null;
}

export interface SessionMessage {
  id: number;
  role: Role;
  ts: string;
  text: string;
  // The text was cut at maxChars; getMessage has the whole of it.
  truncated: boolean;
}

export interface Facet {
  value: string;
  sessions: number;
}

export const SESSION_COLUMNS: FilterColumns = { repo: "s.repo", branch: "s.branch", from: "s.started_at", to: "s.ended_at" };

export function getSession(db: Database, id: string): Session | null {
  return db.query<Session, [string]>("SELECT * FROM sessions WHERE id = ?").get(id);
}

export function listSessions(db: Database, filters: Filters, limit: number): Session[] {
  const { where, params } = filterSql(filters, SESSION_COLUMNS);
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return db.query<Session, any>(`SELECT * FROM sessions s ${clause} ORDER BY s.ended_at DESC LIMIT $limit`).all({ ...params, limit });
}

// Accepts the start of a session id or the exact name given with /rename.
export function findSession(db: Database, ref: string): Session {
  const rows = db
    .query<Session, any>("SELECT * FROM sessions WHERE id LIKE $prefix OR lower(custom_title) = lower($ref) ORDER BY ended_at DESC LIMIT 5")
    .all({ prefix: `${ref}%`, ref });
  if (!rows.length) throw new LembraError("sessionNotFound", { ref });
  if (rows.length > 1) throw new LembraError("sessionAmbiguous", { ref, ids: rows.map((row) => row.id.slice(0, 12)).join(", ") });
  return rows[0]!;
}

// Prompts and /compact summaries in order; replies only when asked (they are most of the volume).
// `maxChars` cuts each text in SQL, so a 16 MB pasted log never leaves the database whole.
export function sessionMessages(db: Database, sessionId: string, opts: { replies?: boolean; maxChars?: number } = {}): SessionMessage[] {
  const roles = opts.replies ? "('prompt', 'summary', 'reply')" : "('prompt', 'summary')";
  const text = opts.maxChars ? "substr(text, 1, $max) AS text, length(text) > $max AS truncated" : "text, 0 AS truncated";
  return db
    .query<Omit<SessionMessage, "truncated"> & { truncated: number }, any>(
      `SELECT id, role, ts, ${text} FROM messages WHERE session_id = $id AND role IN ${roles} ORDER BY ts, id`,
    )
    .all(opts.maxChars ? { id: sessionId, max: opts.maxChars } : { id: sessionId })
    .map((message) => ({ ...message, truncated: message.truncated === 1 }));
}

export function getMessage(db: Database, id: number): string | null {
  return db.query<{ text: string }, [number]>("SELECT text FROM messages WHERE id = ?").get(id)?.text ?? null;
}

// Repos and branches ordered by most recent activity, for filter suggestions.
export function listFacets(db: Database, opts: { repo?: string } = {}): { repos: Facet[]; branches: Facet[] } {
  const repos = db
    .query<Facet, []>(
      "SELECT repo AS value, count(*) AS sessions FROM sessions WHERE repo IS NOT NULL GROUP BY repo ORDER BY max(ended_at) DESC",
    )
    .all();
  const branches = db
    .query<Facet, any>(
      `SELECT branch AS value, count(*) AS sessions FROM sessions
       WHERE branch IS NOT NULL ${opts.repo ? "AND repo LIKE $repo" : ""}
       GROUP BY branch ORDER BY max(ended_at) DESC LIMIT 100`,
    )
    .all(opts.repo ? { repo: `%${opts.repo}%` } : {});
  return { repos, branches };
}

// null for sessions known only from history.jsonl: there is no transcript to resume.
export function resumeCommand(session: Session): string | null {
  if (session.source !== "transcript") return null;
  const cwd = session.cwd ?? ".";
  return `cd '${cwd.replaceAll("'", `'\\''`)}' && claude --resume ${session.id}`;
}
