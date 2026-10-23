import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  path TEXT PRIMARY KEY,
  offset INTEGER NOT NULL DEFAULT 0,
  size INTEGER NOT NULL DEFAULT 0,
  archived_size INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS repos (
  cwd TEXT PRIMARY KEY,
  repo TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  pk INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,              -- 'transcript' | 'history' (only prompts survived)
  cwd TEXT,
  repo TEXT,
  branch TEXT,
  ai_title TEXT,
  custom_title TEXT,
  title TEXT,
  first_prompt TEXT,
  last_prompt TEXT,
  prompt_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  ended_at TEXT,
  cost_usd REAL,
  lines_added INTEGER,
  lines_removed INTEGER
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  role TEXT NOT NULL,                -- 'prompt' | 'reply' | 'summary'
  text TEXT NOT NULL,
  cwd TEXT,
  repo TEXT,
  branch TEXT
);
CREATE INDEX IF NOT EXISTS messages_session ON messages (session_id, ts);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5 (
  text, content = 'messages', content_rowid = 'id', tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts (rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts (messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE OF text ON messages BEGIN
  INSERT INTO messages_fts (messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO messages_fts (rowid, text) VALUES (new.id, new.text);
END;

CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5 (
  title, content = 'sessions', content_rowid = 'pk', tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS sessions_ai AFTER INSERT ON sessions BEGIN
  INSERT INTO sessions_fts (rowid, title) VALUES (new.pk, new.title);
END;
CREATE TRIGGER IF NOT EXISTS sessions_au AFTER UPDATE OF title ON sessions BEGIN
  INSERT INTO sessions_fts (sessions_fts, rowid, title) VALUES ('delete', old.pk, old.title);
  INSERT INTO sessions_fts (rowid, title) VALUES (new.pk, new.title);
END;
CREATE TRIGGER IF NOT EXISTS sessions_ad AFTER DELETE ON sessions BEGIN
  INSERT INTO sessions_fts (sessions_fts, rowid, title) VALUES ('delete', old.pk, old.title);
END;

CREATE TABLE IF NOT EXISTS blobs (
  sha TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  data BLOB NOT NULL                 -- zstd
);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  path TEXT NOT NULL,
  kind TEXT NOT NULL,                -- 'write' | 'edit' | 'read' | 'image' | 'ref'
  sha TEXT REFERENCES blobs (sha),   -- full content after this operation, when known
  size INTEGER
);
CREATE INDEX IF NOT EXISTS files_path ON files (path, ts);
CREATE INDEX IF NOT EXISTS files_session ON files (session_id);
`;

// Columns added after v0.1; databases created earlier gain them on open.
const ADDED_COLUMNS: [table: string, column: string, type: string][] = [
  ["sessions", "digest", "TEXT"], // AI summary (lembra summarize)
  ["sessions", "digest_at", "TEXT"],
  ["files", "secrets", "INTEGER NOT NULL DEFAULT 0"], // credentials found in the stored content
];

export function openDb(dataDir: string): Database {
  mkdirSync(dataDir, { recursive: true });
  // The data dir holds everything ever pasted into a prompt; only the owner may enter it.
  chmodSync(dataDir, 0o700);
  const db = new Database(join(dataDir, "lembra.db"), { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;");
  db.exec(SCHEMA);
  for (const [table, column, type] of ADDED_COLUMNS) {
    const columns = db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all();
    if (!columns.some((existing) => existing.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  return db;
}
