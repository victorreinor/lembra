import type { Database } from "bun:sqlite";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { archiveFile } from "./archive";
import { getBlob, putBlob } from "./blobs";
import { expandHome, type Paths } from "./paths";
import { resolveRepo } from "./repo";
import { countSecrets, REDACTION_VERSION, redact } from "./secrets";
import {
  applyEdit,
  findPaths,
  historyPrompt,
  PARSER_VERSION,
  parseRecord,
  shouldParse,
  type FileOp,
  type ParsedRecord,
} from "./transcript";

const MAX_REF_BYTES = 10 * 1024 * 1024;
const CHUNK_BYTES = 8 * 1024 * 1024;
// history.jsonl gets the prompt before the transcript file exists; give a live session time to create it.
const HISTORY_GRACE_MS = 60 * 60 * 1000;

const INSERT_MESSAGE = `INSERT OR IGNORE INTO messages (uid, session_id, ts, role, text, cwd, repo, branch)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
const SAVE_OFFSET = `INSERT INTO sources (path, offset, size) VALUES (?, ?, ?)
  ON CONFLICT (path) DO UPDATE SET offset = excluded.offset, size = excluded.size`;

export interface IndexStats {
  scanned: number;
  changed: number;
  messages: number;
  files: number;
  history: number;
}

export interface Source {
  abs: string;
  rel: string;
  sessionId: string;
  subagent: boolean;
  size: number;
  mtime: number;
}

interface SourceState {
  offset: number;
  size: number;
  archived_size: number;
}

interface SessionUpdate {
  cwd?: string;
  branch?: string;
  aiTitle?: string;
  customTitle?: string;
  cost?: ParsedRecord["cost"];
  firstTs?: string;
  lastTs?: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Transcripts live at projects/<dir>/<session>.jsonl; subagents at projects/<dir>/<session>/subagents/<agent>.jsonl.
export function listSources(projectsDir: string): Source[] {
  if (!existsSync(projectsDir)) return [];
  const sources: Source[] = [];
  for (const rel of new Bun.Glob("**/*.jsonl").scanSync({ cwd: projectsDir })) {
    const parts = rel.split("/");
    const main = parts.length === 2;
    const subagent = parts.length === 4 && parts[2] === "subagents";
    if (!main && !subagent) continue;
    const abs = join(projectsDir, rel);
    const stat = statSync(abs);
    const sessionId = main ? basename(rel, ".jsonl") : parts[1]!;
    sources.push({ abs, rel, sessionId, subagent, size: stat.size, mtime: stat.mtimeMs });
  }
  // Oldest first, so an edit finds the version written by an earlier session.
  return sources.sort((a, b) => a.mtime - b.mtime);
}

export interface IndexOptions {
  // Also refresh the raw zstd copy of every changed transcript.
  archive?: boolean;
  chunkBytes?: number;
}

// Incremental: each file is read from the byte offset where the previous run stopped.
export async function indexAll(db: Database, paths: Paths, opts: IndexOptions = {}): Promise<IndexStats> {
  rereadIfParserChanged(db);
  const sources = listSources(join(paths.claudeDir, "projects"));
  const stats: IndexStats = { scanned: sources.length, changed: 0, messages: 0, files: 0, history: 0 };
  const indexer = new Indexer(db, paths.dataDir);
  const redaction = db.query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'redaction_version'").get();
  if (redaction?.value !== String(REDACTION_VERSION)) indexer.redactStored();
  for (const source of sources) {
    const state = sourceState(db, source.abs);
    if (opts.archive && state.archived_size !== source.size) await archiveFile(db, paths, source.abs, source.size);
    if (state.size === source.size) continue;
    let offset = state.offset <= source.size ? state.offset : 0;
    for await (const chunk of completeLines(source.abs, offset, source.size, opts.chunkBytes ?? CHUNK_BYTES)) {
      db.transaction(() => {
        indexer.indexLines(source, chunk.lines, stats);
        // Size stays 0 until the whole file is read, so an interrupted run resumes from this offset.
        db.query(SAVE_OFFSET).run(source.abs, chunk.next, 0);
      })();
      offset = chunk.next;
    }
    db.query(SAVE_OFFSET).run(source.abs, offset, source.size);
    stats.changed++;
  }
  stats.history = await importHistory(db, indexer, paths, sources, opts);
  return stats;
}

// Yields whole lines in bounded chunks, so a 200 MB transcript never sits in memory as one string.
// A trailing line still being written is left for the next run.
async function* completeLines(path: string, start: number, size: number, chunkBytes: number) {
  const file = Bun.file(path);
  let offset = start;
  let chunk = chunkBytes;
  while (offset < size) {
    const bytes = await file.slice(offset, Math.min(offset + chunk, size)).bytes();
    const end = bytes.lastIndexOf(10) + 1;
    if (end === 0) {
      if (offset + bytes.length >= size) return;
      chunk *= 2; // one line is longer than the chunk
      continue;
    }
    offset += end;
    chunk = chunkBytes;
    yield { lines: decoder.decode(bytes.subarray(0, end)).split("\n"), next: offset };
  }
}

function rereadIfParserChanged(db: Database) {
  const stored = db.query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'parser_version'").get();
  if (stored?.value === String(PARSER_VERSION)) return;
  db.transaction(() => {
    db.query("UPDATE sources SET offset = 0, size = 0").run();
    db.query("INSERT OR REPLACE INTO meta (key, value) VALUES ('parser_version', ?)").run(String(PARSER_VERSION));
  })();
}

function sourceState(db: Database, path: string): SourceState {
  const row = db.query<SourceState, [string]>("SELECT offset, size, archived_size FROM sources WHERE path = ?").get(path);
  return row ?? { offset: 0, size: 0, archived_size: 0 };
}

// Prompts from sessions whose transcript Claude Code already deleted survive only in history.jsonl.
async function importHistory(
  db: Database,
  indexer: Indexer,
  paths: Paths,
  sources: Source[],
  opts: { archive?: boolean },
): Promise<number> {
  const file = join(paths.claudeDir, "history.jsonl");
  if (!existsSync(file)) return 0;
  const size = statSync(file).size;
  const state = sourceState(db, file);
  if (opts.archive && state.archived_size !== size) await archiveFile(db, paths, file, size);
  if (state.size === size) return 0;

  const text = await Bun.file(file).text();
  const withTranscript = new Set(sources.filter((source) => !source.subagent).map((source) => source.sessionId));
  for (const { id } of db.query<{ id: string }, []>("SELECT id FROM sessions WHERE source = 'transcript'").all()) {
    withTranscript.add(id);
  }
  const cutoff = Date.now() - HISTORY_GRACE_MS;
  let added = 0;
  db.transaction(() => {
    const sessions = new Map<string, SessionUpdate>();
    for (const line of text.split("\n")) {
      let entry: any;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const id = entry.sessionId;
      const at = Number(entry.timestamp);
      if (!id || withTranscript.has(id) || !(at < cutoff) || indexer.isOwnSession(entry.project)) continue;
      const prompt = historyPrompt(entry);
      if (!prompt) continue;
      const ts = new Date(at).toISOString();
      const cwd = entry.project ?? null;
      const session = sessions.get(id) ?? {};
      merge(session, { ts, cwd, sidechain: false, messages: [], files: [] });
      sessions.set(id, session);
      // `changes` also counts the FTS trigger's writes, so treat it as a boolean.
      if (db.query(INSERT_MESSAGE).run(`h:${id}:${at}`, id, ts, "prompt", redact(prompt).text, cwd, indexer.repoOf(cwd), null).changes) added++;
    }
    for (const [id, session] of sessions) indexer.updateSession(id, "history", session);
    db.query(SAVE_OFFSET).run(file, size, size);
  })();
  return added;
}

function merge(session: SessionUpdate, record: ParsedRecord) {
  session.cwd = record.cwd ?? session.cwd;
  session.branch = record.branch ?? session.branch;
  session.aiTitle = record.aiTitle ?? session.aiTitle;
  session.customTitle = record.customTitle ?? session.customTitle;
  session.cost = record.cost ?? session.cost;
  if (record.ts) {
    if (!session.firstTs || record.ts < session.firstTs) session.firstTs = record.ts;
    if (!session.lastTs || record.ts > session.lastTs) session.lastTs = record.ts;
  }
}

function latestText(db: Database, path: string): string | undefined {
  const row = db
    .query<{ sha: string }, [string]>(
      "SELECT sha FROM files WHERE path = ? AND sha IS NOT NULL AND kind != 'image' ORDER BY ts DESC, id DESC LIMIT 1",
    )
    .get(path);
  const data = row && getBlob(db, row.sha);
  return data ? decoder.decode(data) : undefined;
}

function contentOf(db: Database, op: FileOp): Uint8Array | undefined {
  switch (op.kind) {
    case "write":
    case "read":
      return encoder.encode(op.content);
    case "image":
      return Buffer.from(op.base64, "base64");
    case "edit": {
      // Edit results usually carry the whole file as it was before the edit; otherwise build on the last version seen.
      const base = op.original ?? latestText(db, op.path);
      const next = base === undefined ? undefined : applyEdit(base, op);
      return next === undefined ? undefined : encoder.encode(next);
    }
  }
}

class Indexer {
  private repos = new Map<string, string>();

  constructor(
    private db: Database,
    private dataDir: string,
  ) {}

  // Sessions lembra itself starts (AI summaries) run inside its data dir and are not user history.
  isOwnSession(cwd: string | null | undefined): boolean {
    return Boolean(cwd && (cwd === this.dataDir || cwd.startsWith(`${this.dataDir}/`)));
  }

  repoOf(cwd: string | null | undefined): string | null {
    if (!cwd) return null;
    let repo = this.repos.get(cwd);
    if (repo === undefined) {
      repo = resolveRepo(this.db, cwd);
      this.repos.set(cwd, repo);
    }
    return repo;
  }

  indexLines(source: Source, lines: string[], stats: IndexStats) {
    const session: SessionUpdate = {};
    for (const line of lines) {
      if (!shouldParse(line)) continue;
      let record: any;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      const parsed = parseRecord(record);
      if (this.isOwnSession(parsed.cwd)) return;
      const ts = parsed.ts ?? session.lastTs ?? new Date().toISOString();
      for (const op of parsed.files) {
        if (this.addFile(source.sessionId, ts, op)) stats.files++;
      }
      if (source.subagent || parsed.sidechain) continue;
      merge(session, parsed);
      const cwd = parsed.cwd ?? session.cwd ?? null;
      const branch = parsed.branch ?? session.branch ?? null;
      for (const message of parsed.messages) {
        const { changes } = this.db
          .query(INSERT_MESSAGE)
          .run(message.uid, source.sessionId, ts, message.role, redact(message.text).text, cwd, this.repoOf(cwd), branch);
        if (!changes) continue;
        stats.messages++;
        if (message.role === "prompt") stats.files += this.captureRefs(source.sessionId, message.uid, message.text);
      }
    }
    if (!source.subagent) this.updateSession(source.sessionId, "transcript", session);
  }

  updateSession(id: string, source: "transcript" | "history", session: SessionUpdate) {
    const existing = this.db.query<{ source: string }, [string]>("SELECT source FROM sessions WHERE id = ?").get(id);
    if (!existing) {
      this.db.query("INSERT INTO sessions (id, source) VALUES (?, ?)").run(id, source);
    } else if (existing.source === "history" && source === "transcript") {
      // The transcript is a richer copy of the same prompts.
      this.db.query("DELETE FROM messages WHERE session_id = ? AND uid LIKE 'h:%'").run(id);
      this.db.query("UPDATE sessions SET source = 'transcript' WHERE id = ?").run(id);
    }
    this.db
      .query(
        `UPDATE sessions SET
          cwd = coalesce($cwd, cwd),
          repo = coalesce($repo, repo),
          branch = coalesce($branch, branch),
          ai_title = coalesce($aiTitle, ai_title),
          custom_title = coalesce($customTitle, custom_title),
          cost_usd = coalesce($cost, cost_usd),
          lines_added = coalesce($added, lines_added),
          lines_removed = coalesce($removed, lines_removed),
          started_at = CASE WHEN started_at IS NULL OR started_at > $first THEN $first ELSE started_at END,
          ended_at = CASE WHEN ended_at IS NULL OR ended_at < $last THEN $last ELSE ended_at END
        WHERE id = $id`,
      )
      .run({
        id,
        cwd: session.cwd ?? null,
        repo: this.repoOf(session.cwd),
        branch: session.branch ?? null,
        aiTitle: session.aiTitle ? redact(session.aiTitle).text : null,
        customTitle: session.customTitle ? redact(session.customTitle).text : null,
        cost: session.cost?.usd ?? null,
        added: session.cost?.added ?? null,
        removed: session.cost?.removed ?? null,
        first: session.firstTs ?? null,
        last: session.lastTs ?? null,
      });
    this.db
      .query(
        `UPDATE sessions SET
          first_prompt = (SELECT text FROM messages WHERE session_id = $id AND role = 'prompt' ORDER BY ts, id LIMIT 1),
          last_prompt = (SELECT text FROM messages WHERE session_id = $id AND role = 'prompt' ORDER BY ts DESC, id DESC LIMIT 1),
          prompt_count = (SELECT count(*) FROM messages WHERE session_id = $id AND role = 'prompt')
        WHERE id = $id`,
      )
      .run({ id });
    this.db.query("UPDATE sessions SET title = coalesce(custom_title, ai_title, substr(first_prompt, 1, 120)) WHERE id = ?").run(id);
  }

  private addFile(sessionId: string, ts: string, op: FileOp): boolean {
    if (this.db.query("SELECT 1 FROM files WHERE uid = ?").get(op.uid)) return false;
    return this.insertFile(sessionId, ts, op.uid, op.path, op.kind, contentOf(this.db, op));
  }

  private insertFile(sessionId: string, ts: string, uid: string, path: string, kind: string, data?: Uint8Array): boolean {
    const sha = data ? putBlob(this.db, data) : null;
    const { changes } = this.db
      .query("INSERT OR IGNORE INTO files (uid, session_id, ts, path, kind, sha, size, secrets) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(uid, sessionId, ts, path, kind, sha, data?.byteLength ?? null, data ? countSecrets(data) : 0);
    return changes > 0;
  }

  // Masks secrets stored before the current rules existed: messages, titles, summaries; flags stored files.
  redactStored() {
    const changed = this.db
      .query<{ id: number; session_id: string; text: string }, []>("SELECT id, session_id, text FROM messages")
      .all()
      .map((row) => ({ ...row, redacted: redact(row.text) }))
      .filter((row) => row.redacted.count > 0);
    const sessions = this.db.query<{ id: string; source: "transcript" | "history"; ai_title: string | null; custom_title: string | null; digest: string | null }, []>(
      "SELECT id, source, ai_title, custom_title, digest FROM sessions",
    ).all();
    const blobs = this.db.query<{ sha: string }, []>("SELECT DISTINCT sha FROM files WHERE sha IS NOT NULL AND kind != 'image'").all();

    this.db.transaction(() => {
      for (const row of changed) this.db.query("UPDATE messages SET text = ? WHERE id = ?").run(row.redacted.text, row.id);
      for (const session of sessions) {
        const masked = (value: string | null) => (value ? redact(value).text : null);
        this.db
          .query("UPDATE sessions SET ai_title = ?, custom_title = ?, digest = ? WHERE id = ?")
          .run(masked(session.ai_title), masked(session.custom_title), masked(session.digest), session.id);
      }
      // First/last prompt and the derived title come from the (now masked) messages.
      for (const id of new Set(changed.map((row) => row.session_id))) {
        const source = sessions.find((session) => session.id === id)?.source ?? "transcript";
        this.updateSession(id, source, {});
      }
      for (const { id } of sessions) this.db.query("UPDATE sessions SET title = coalesce(custom_title, ai_title, substr(first_prompt, 1, 120)) WHERE id = ?").run(id);
      for (const { sha } of blobs) {
        const data = getBlob(this.db, sha);
        if (data) this.db.query("UPDATE files SET secrets = ? WHERE sha = ?").run(countSecrets(data), sha);
      }
      this.db.query("INSERT OR REPLACE INTO meta (key, value) VALUES ('redaction_version', ?)").run(String(REDACTION_VERSION));
    })();
  }

  // Files named in a prompt (~/Downloads/x.sql) tend to be deleted later; keep a copy while they exist.
  private captureRefs(sessionId: string, messageUid: string, text: string): number {
    let added = 0;
    for (const ref of findPaths(text)) {
      const path = expandHome(ref);
      if (path.includes("/.claude/projects/")) continue;
      try {
        const stat = statSync(path);
        if (!stat.isFile() || stat.size > MAX_REF_BYTES) continue;
        if (this.insertFile(sessionId, new Date().toISOString(), `${messageUid}:ref:${path}`, path, "ref", readFileSync(path))) added++;
      } catch {
        continue;
      }
    }
    return added;
  }
}
