import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { getBlob } from "./blobs";
import { LembraError } from "./errors";
import { expandHome } from "./paths";

export interface StoredFile {
  id: number;
  session_id: string;
  ts: string;
  path: string;
  kind: "write" | "edit" | "read" | "image" | "ref";
  sha: string | null;
  size: number | null;
  repo: string | null;
  versions: number;
  // Credentials found in the stored content (the content itself is kept intact for restores).
  secrets: number;
}

export type StoredVersion = StoredFile & { sha: string };

const COLUMNS = `f.id, f.session_id, f.ts, f.path, f.kind, f.sha, f.size, f.secrets, s.repo,
  (SELECT count(*) FROM files v WHERE v.path = f.path AND v.sha IS NOT NULL) AS versions`;
const FROM = "FROM files f LEFT JOIN sessions s ON s.id = f.session_id";

// One row per real path, pointing at its most recent stored version.
export function latestFiles(db: Database, filters: { term?: string; repo?: string; since?: string }): StoredFile[] {
  const where = [
    "f.id = (SELECT v.id FROM files v WHERE v.path = f.path AND v.sha IS NOT NULL ORDER BY v.ts DESC, v.id DESC LIMIT 1)",
    "f.path LIKE '/%'",
  ];
  const params: Record<string, string> = {};
  if (filters.term) {
    where.push("f.path LIKE $term");
    params.term = `%${filters.term}%`;
  }
  if (filters.repo) {
    where.push("s.repo LIKE $repo");
    params.repo = `%${filters.repo}%`;
  }
  if (filters.since) {
    where.push("f.ts >= $since");
    params.since = filters.since;
  }
  return db.query<StoredFile, any>(`SELECT ${COLUMNS} ${FROM} WHERE ${where.join(" AND ")} ORDER BY f.ts DESC`).all(params);
}

// The last state of each path one session touched, preferring versions whose content we have.
export function sessionFiles(db: Database, sessionId: string): StoredFile[] {
  return db
    .query<StoredFile, any>(
      `SELECT ${COLUMNS} ${FROM}
       WHERE f.session_id = $id AND f.id = (
         SELECT v.id FROM files v WHERE v.session_id = $id AND v.path = f.path
         ORDER BY v.sha IS NOT NULL DESC, v.ts DESC, v.id DESC LIMIT 1
       )
       ORDER BY f.ts`,
    )
    .all({ id: sessionId });
}

// Accepts a file id (#123) or a path, which resolves to that path's latest version.
export function resolveFile(db: Database, ref: string): StoredVersion {
  const id = ref.match(/^#?(\d+)$/)?.[1];
  const row = id
    ? db.query<StoredFile, any>(`SELECT ${COLUMNS} ${FROM} WHERE f.id = $id`).get({ id: Number(id) })
    : db
        .query<StoredFile, any>(`SELECT ${COLUMNS} ${FROM} WHERE f.path = $path AND f.sha IS NOT NULL ORDER BY f.ts DESC, f.id DESC LIMIT 1`)
        .get({ path: resolve(expandHome(ref)) });
  if (!row) throw new LembraError("fileNotFound", { ref });
  if (!row.sha) throw new LembraError("fileWithoutContent", { path: row.path });
  return row as StoredVersion;
}

export function readStoredFile(db: Database, file: StoredVersion): Uint8Array {
  return getBlob(db, file.sha)!;
}

// Writes a stored version back to disk: its original path by default, or `to` (a file or a directory).
export async function restoreFile(
  db: Database,
  ref: string,
  opts: { to?: string; force?: boolean; cwd?: string } = {},
): Promise<{ file: StoredVersion; dest: string }> {
  const file = resolveFile(db, ref);
  let dest = resolve(opts.cwd ?? process.cwd(), expandHome(opts.to ?? file.path));
  if (existsSync(dest) && statSync(dest).isDirectory()) dest = join(dest, basename(file.path));
  if (existsSync(dest) && !opts.force) throw new LembraError("destinationExists", { dest });
  mkdirSync(dirname(dest), { recursive: true });
  await Bun.write(dest, readStoredFile(db, file));
  return { file, dest };
}

export function isMissing(file: Pick<StoredFile, "path">): boolean {
  return !isAbsolute(file.path) || !existsSync(file.path);
}
