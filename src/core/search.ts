import type { Database } from "bun:sqlite";
import { filterSql, toMatchQuery, type Filters } from "./query";
import { getSession, SESSION_COLUMNS, type Session } from "./sessions";
import type { Role } from "./transcript";

export interface Snippet {
  role: Role;
  ts: string;
  // Matched terms are wrapped in \x01…\x02 so each interface decides how to highlight them.
  text: string;
}

export interface Hit {
  session: Session;
  snippets: Snippet[];
}

const SNIPPETS_PER_SESSION = 2;

// Ranks sessions by their best-matching prompt, reply, /compact summary or title.
export function search(db: Database, input: string, filters: Filters, opts: { promptsOnly?: boolean; limit: number }): Hit[] {
  const match = toMatchQuery(input);
  if (!match) return [];

  const m = filterSql(filters, { repo: "m.repo", branch: "m.branch", from: "m.ts", to: "m.ts" });
  if (opts.promptsOnly) m.where.push("m.role = 'prompt'");
  const rows = db
    .query<Snippet & { session_id: string; score: number }, any>(
      `SELECT m.session_id, m.role, m.ts,
         snippet(messages_fts, 0, char(1), char(2), '…', 24) AS text,
         bm25(messages_fts) * CASE m.role WHEN 'prompt' THEN 2.0 WHEN 'reply' THEN 1.0 ELSE 1.5 END AS score
       FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid
       WHERE messages_fts MATCH $match ${m.where.map((clause) => `AND ${clause}`).join(" ")}
       ORDER BY score LIMIT 2000`,
    )
    .all({ match, ...m.params });

  // bm25 is negative: lower is a better match. Rows arrive best-first.
  const best = new Map<string, { score: number; snippets: Snippet[] }>();
  for (const { session_id, score, ...snippet } of rows) {
    const hit = best.get(session_id) ?? { score, snippets: [] };
    if (hit.snippets.length < SNIPPETS_PER_SESSION) hit.snippets.push(snippet);
    best.set(session_id, hit);
  }

  if (!opts.promptsOnly) {
    const s = filterSql(filters, SESSION_COLUMNS);
    const titles = db
      .query<{ id: string; score: number }, any>(
        `SELECT s.id, bm25(sessions_fts) * 3.0 AS score
         FROM sessions_fts JOIN sessions s ON s.pk = sessions_fts.rowid
         WHERE sessions_fts MATCH $match ${s.where.map((clause) => `AND ${clause}`).join(" ")}`,
      )
      .all({ match, ...s.params });
    for (const { id, score } of titles) {
      const hit = best.get(id) ?? { score, snippets: [] };
      hit.score = Math.min(hit.score, score);
      best.set(id, hit);
    }
  }

  return [...best.entries()]
    .sort((a, b) => a[1].score - b[1].score)
    .slice(0, opts.limit)
    .flatMap(([id, hit]) => {
      const session = getSession(db, id);
      return session ? [{ session, snippets: hit.snippets }] : [];
    });
}
