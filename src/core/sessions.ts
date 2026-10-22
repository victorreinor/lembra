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
}

export interface SessionMessage {
  role: Role;
  ts: string;
  text: string;
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
  if (!rows.length) throw new LembraError(`Nenhuma sessão com id ou nome "${ref}".`);
  if (rows.length > 1) throw new LembraError(`"${ref}" é ambíguo: ${rows.map((row) => row.id.slice(0, 12)).join(", ")}…`);
  return rows[0]!;
}

export function sessionMessages(db: Database, sessionId: string, opts: { replies?: boolean } = {}): SessionMessage[] {
  const roles = opts.replies ? "" : "AND role != 'reply'";
  return db
    .query<SessionMessage, any>(`SELECT role, ts, text FROM messages WHERE session_id = $id ${roles} ORDER BY ts, id`)
    .all({ id: sessionId });
}

export function resumeCommand(session: Session): string {
  const cwd = session.cwd ?? ".";
  return `cd '${cwd.replaceAll("'", `'\\''`)}' && claude --resume ${session.id}`;
}
