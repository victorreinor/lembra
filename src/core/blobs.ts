import type { Database } from "bun:sqlite";

// Content-addressed, so the same file captured by many sessions is stored once.
export function putBlob(db: Database, data: Uint8Array): string {
  const sha = new Bun.CryptoHasher("sha256").update(data).digest("hex");
  if (!db.query("SELECT 1 FROM blobs WHERE sha = ?").get(sha)) {
    db.query("INSERT INTO blobs (sha, size, data) VALUES (?, ?, ?)").run(sha, data.byteLength, Bun.zstdCompressSync(data));
  }
  return sha;
}

export function getBlob(db: Database, sha: string): Uint8Array | undefined {
  const row = db.query<{ data: Uint8Array }, [string]>("SELECT data FROM blobs WHERE sha = ?").get(sha);
  return row ? Bun.zstdDecompressSync(row.data) : undefined;
}
