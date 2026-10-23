import type { Database } from "bun:sqlite";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { pipeline } from "node:stream/promises";
import { createZstdCompress, createZstdDecompress } from "node:zlib";
import type { Paths } from "./paths";

// raw/ mirrors ~/.claude: raw/projects/<dir>/<session>.jsonl.zst, raw/history.jsonl.zst.
export function archivePath(paths: Paths, source: string): string {
  return join(paths.dataDir, "raw", `${relative(paths.claudeDir, source)}.zst`);
}

// Streams through zstd so a 200 MB transcript never sits in memory, and renames at the end
// so an interrupted run never leaves a truncated copy behind.
async function streamTo(src: string, dest: string, transform: NodeJS.ReadWriteStream) {
  mkdirSync(dirname(dest), { recursive: true });
  const partial = `${dest}.partial`;
  await pipeline(createReadStream(src), transform, createWriteStream(partial));
  renameSync(partial, dest);
}

export async function archiveFile(db: Database, paths: Paths, source: string, size: number) {
  await streamTo(source, archivePath(paths, source), createZstdCompress());
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
  await streamTo(raw, row.path, createZstdDecompress());
  return "restored";
}
