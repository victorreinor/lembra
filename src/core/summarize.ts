import type { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { CORE } from "../i18n/core";
import type { Locale } from "../i18n/locale";
import { LembraError } from "./errors";
import type { Paths } from "./paths";
import { redact } from "./secrets";
import { sessionMessages, type Session, type SessionMessage } from "./sessions";
import { clip } from "./text";

// Turns a prompt into a summary. The default runs Claude headless; tests pass a fake.
export type Runner = (prompt: string) => Promise<string>;

const MAX_TRANSCRIPT_CHARS = 24_000;
// Sessions touched in the last half hour may still be going; summarize them later.
const ACTIVE_GRACE_MS = 30 * 60 * 1000;

// Uses the user's own Claude Code login; --no-session-persistence keeps these runs out of the history.
export function claudeRunner(paths: Paths, model = "haiku"): Runner {
  const cwd = join(paths.dataDir, "summaries");
  mkdirSync(cwd, { recursive: true });
  return async (prompt) => {
    const proc = Bun.spawn(["claude", "-p", "--model", model, "--no-session-persistence"], {
      cwd,
      stdin: new Blob([prompt]),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (code !== 0) throw new LembraError("summaryFailed", { code, detail: clip(err.trim() || out.trim(), 300) });
    return out.trim();
  };
}

// The summary comes out in `locale`, the language the user reads lembra in.
export function summaryPrompt(session: Session, messages: SessionMessage[], locale: Locale): string {
  const t = CORE[locale].summary;
  let transcript = messages
    .map((message) => `[${t.speakers[message.role]}] ${clip(message.text, message.role === "reply" ? 1500 : 3000)}`)
    .join("\n\n");
  // Long sessions keep their opening (the goal) and their ending (where it stopped).
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    const head = MAX_TRANSCRIPT_CHARS / 3;
    transcript = `${transcript.slice(0, head)}\n\n[…]\n\n${transcript.slice(-(MAX_TRANSCRIPT_CHARS - head))}`;
  }
  return `${t.instructions}\n\n${t.context(session.repo ?? "?", session.branch ?? "?", session.title ?? "?")}\n\n<session>\n${transcript}\n</session>`;
}

// Finished sessions with real back-and-forth that have no summary yet, or changed after it.
export function sessionsToSummarize(db: Database, opts: { limit: number; now?: Date }): Session[] {
  const cutoff = new Date((opts.now ?? new Date()).getTime() - ACTIVE_GRACE_MS).toISOString();
  return db
    .query<Session, any>(
      `SELECT * FROM sessions
       WHERE source = 'transcript' AND prompt_count >= 2 AND ended_at < $cutoff AND (digest_at IS NULL OR digest_at < ended_at)
       ORDER BY ended_at DESC LIMIT $limit`,
    )
    .all({ cutoff, limit: opts.limit });
}

export async function summarizeSession(db: Database, session: Session, runner: Runner, locale: Locale): Promise<string> {
  // The model sees masked text already; masking its answer too covers anything it reconstructs.
  const digest = redact((await runner(summaryPrompt(session, sessionMessages(db, session.id, { replies: true }), locale))).trim()).text;
  if (!digest) throw new LembraError("summaryEmpty", { id: session.id.slice(0, 8) });
  const uid = `digest:${session.id}`;
  db.transaction(() => {
    db.query("UPDATE sessions SET digest = ?, digest_at = ? WHERE id = ?").run(digest, new Date().toISOString(), session.id);
    // Stored as a message too, so the summary's words become searchable.
    db.query("DELETE FROM messages WHERE uid = ?").run(uid);
    db.query("INSERT INTO messages (uid, session_id, ts, role, text, cwd, repo, branch) VALUES (?, ?, ?, 'digest', ?, ?, ?, ?)").run(
      uid,
      session.id,
      session.ended_at ?? new Date().toISOString(),
      digest,
      session.cwd,
      session.repo,
      session.branch,
    );
  })();
  return digest;
}
