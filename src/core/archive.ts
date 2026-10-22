import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { Paths } from "./paths";

// raw/ mirrors ~/.claude: raw/projects/<dir>/<session>.jsonl.zst, raw/history.jsonl.zst.
export function archivePath(paths: Paths, source: string): string {
  return join(paths.dataDir, "raw", `${relative(paths.claudeDir, source)}.zst`);
}

export async function archiveFile(db: Database, paths: Paths, source: string, size: number) {
  const dest = archivePath(paths, source);
  mkdirSync(dirname(dest), { recursive: true });
  await Bun.write(dest, Bun.zstdCompressSync(await Bun.file(source).bytes()));
  db.query(
    "INSERT INTO sources (path, archived_size) VALUES (?, ?) ON CONFLICT (path) DO UPDATE SET archived_size = excluded.archived_size",
  ).run(source, size);
}

// Puts back a transcript Claude Code deleted, so `claude --resume` finds the session again.
export async function restoreTranscript(db: Database, paths: Paths, sessionId: string): Promise<"present" | "restored" | "unavailable"> {
  const row = db.query<{ path: string }, any>("SELECT path FROM sources WHERE path LIKE $pattern").get({ pattern: `%/${sessionId}.jsonl` });
  if (!row) return "unavailable";
  if (existsSync(row.path)) return "present";
  const raw = archivePath(paths, row.path);
  if (!existsSync(raw)) return "unavailable";
  mkdirSync(dirname(row.path), { recursive: true });
  await Bun.write(row.path, Bun.zstdDecompressSync(await Bun.file(raw).bytes()));
  return "restored";
}
