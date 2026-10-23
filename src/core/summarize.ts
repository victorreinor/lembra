import type { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { LembraError } from "./errors";
import type { Paths } from "./paths";
import { sessionMessages, type Session, type SessionMessage } from "./sessions";
import { clip } from "./text";

// Turns a prompt into a summary. The default runs Claude headless; tests pass a fake.
export type Runner = (prompt: string) => Promise<string>;

const MAX_TRANSCRIPT_CHARS = 24_000;
// Sessions touched in the last half hour may still be going; summarize them later.
const ACTIVE_GRACE_MS = 30 * 60 * 1000;
const SPEAKER: Record<string, string> = { prompt: "usuário", reply: "claude", summary: "resumo do /compact", digest: "resumo" };

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
    if (code !== 0) throw new LembraError(`claude -p terminou com erro ${code}: ${clip(err.trim() || out.trim(), 300)}`);
    return out.trim();
  };
}

export function summaryPrompt(session: Session, messages: SessionMessage[]): string {
  let transcript = messages
    .map((message) => `[${SPEAKER[message.role]}] ${clip(message.text, message.role === "reply" ? 1500 : 3000)}`)
    .join("\n\n");
  // Long sessions keep their opening (the goal) and their ending (where it stopped).
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    const head = MAX_TRANSCRIPT_CHARS / 3;
    transcript = `${transcript.slice(0, head)}\n\n[…]\n\n${transcript.slice(-(MAX_TRANSCRIPT_CHARS - head))}`;
  }
  return `Resuma esta sessão do Claude Code para que alguém a encontre e retome o trabalho no futuro.
Responda em português do Brasil, em no máximo 6 linhas e sem introdução.
Linha 1: o objetivo da sessão numa frase.
Depois: o que foi feito, decisões importantes, arquivos ou comandos centrais e o que ficou pendente.
Use os termos que a pessoa usaria para buscar: nomes de tabelas, módulos, telas, erros, clientes.

Repositório: ${session.repo ?? "?"} · branch: ${session.branch ?? "?"} · título: ${session.title ?? "?"}

<sessao>
${transcript}
</sessao>`;
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

export async function summarizeSession(db: Database, session: Session, runner: Runner): Promise<string> {
  const digest = (await runner(summaryPrompt(session, sessionMessages(db, session.id, { replies: true })))).trim();
  if (!digest) throw new LembraError(`O resumo da sessão ${session.id.slice(0, 8)} veio vazio.`);
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
