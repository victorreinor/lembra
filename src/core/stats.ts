import type { Database } from "bun:sqlite";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isMissing, latestFiles } from "./files";
import { listSources } from "./indexer";
import type { Paths } from "./paths";

export interface LembraStats {
  sessions: number;
  historyOnly: number;
  oldest: string | null;
  prompts: number;
  replies: number;
  summaries: number;
  paths: number;
  versions: number;
  missing: number;
  dbBytes: number;
  rawBytes: number;
  claudeBytes: number;
  retentionDays: number | null;
  maskedMessages: number;
  secretFiles: number;
}

export function collectStats(db: Database, paths: Paths): LembraStats {
  const sessions = db
    .query<{ transcript: number | null; history: number | null; oldest: string | null }, []>(
      "SELECT sum(source = 'transcript') AS transcript, sum(source = 'history') AS history, min(started_at) AS oldest FROM sessions",
    )
    .get()!;
  const roles = new Map(
    db
      .query<{ role: string; n: number }, []>("SELECT role, count(*) AS n FROM messages GROUP BY role")
      .all()
      .map((row) => [row.role, row.n]),
  );
  const versions = db.query<{ n: number }, []>("SELECT count(*) AS n FROM files WHERE sha IS NOT NULL AND path LIKE '/%'").get()!.n;
  const files = latestFiles(db, {});
  const claudeBytes = listSources(join(paths.claudeDir, "projects")).reduce((sum, source) => sum + source.size, 0);
  return {
    sessions: sessions.transcript ?? 0,
    historyOnly: sessions.history ?? 0,
    oldest: sessions.oldest,
    prompts: roles.get("prompt") ?? 0,
    replies: roles.get("reply") ?? 0,
    summaries: roles.get("summary") ?? 0,
    paths: files.length,
    versions,
    missing: files.filter(isMissing).length,
    dbBytes: sizeOf(join(paths.dataDir, "lembra.db")) + sizeOf(join(paths.dataDir, "lembra.db-wal")),
    rawBytes: treeSize(join(paths.dataDir, "raw")),
    claudeBytes: claudeBytes + sizeOf(join(paths.claudeDir, "history.jsonl")),
    retentionDays: retentionDays(paths.claudeDir),
    maskedMessages: db.query<{ n: number }, []>("SELECT count(*) AS n FROM messages WHERE text LIKE '%[REDACTED:%'").get()!.n,
    secretFiles: db.query<{ n: number }, []>("SELECT count(DISTINCT path) AS n FROM files WHERE secrets > 0").get()!.n,
  };
}

// Claude Code deletes transcripts older than cleanupPeriodDays (30 when unset).
export function retentionDays(claudeDir: string): number | null {
  try {
    const days = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf8")).cleanupPeriodDays;
    return typeof days === "number" ? days : null;
  } catch {
    return null;
  }
}

function sizeOf(path: string): number {
  return existsSync(path) ? statSync(path).size : 0;
}

function treeSize(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const rel of new Bun.Glob("**/*").scanSync({ cwd: dir })) total += statSync(join(dir, rel)).size;
  return total;
}
