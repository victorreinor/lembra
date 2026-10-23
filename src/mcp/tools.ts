import type { Database } from "bun:sqlite";
import { isAbsolute } from "node:path";
import { LembraError } from "../core/errors";
import { isMissing, latestFiles, readStoredFile, resolveFile, sessionFiles } from "../core/files";
import { buildHandoff } from "../core/handoff";
import type { Paths } from "../core/paths";
import { describeReasons, findPending } from "../core/pending";
import { parseDate, type Filters } from "../core/query";
import { search } from "../core/search";
import type { Services } from "../core/services";
import { findSession, listSessions, resumeCommand, sessionMessages, type Session } from "../core/sessions";
import { bracketMatches, clip, oneLine, repoName, shortPath, textFormat } from "../core/text";
import type { Locale } from "../i18n/locale";
import { MCP } from "../i18n/mcp";

export interface ToolContext {
  db: Database;
  paths: Paths;
  services: Services;
  locale: Locale;
}

export interface Tool {
  name: string;
  // English on purpose: descriptions are instructions for the model, not text for the user.
  description: string;
  inputSchema: { type: "object"; properties: Record<string, object>; required?: string[] };
  run(ctx: ToolContext, args: Record<string, unknown>): Promise<string> | string;
}

const FILTERS = {
  repo: { type: "string", description: "Part of the repository name (e.g. billing-api)" },
  branch: { type: "string", description: "Part of the branch name" },
  since: { type: "string", description: "From: 2026-10-01, 7d, 2w, 3m" },
  until: { type: "string", description: "Until (inclusive), same format as since" },
};
const LIMIT = { type: "integer", minimum: 1, maximum: 50, description: "Number of results" };

function text(args: Record<string, unknown>, key: string, required = false): string | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === "") {
    if (required) throw new LembraError("missingParam", { key });
    return undefined;
  }
  if (typeof value !== "string") throw new LembraError("paramNotText", { key });
  return value;
}

function limitOf(args: Record<string, unknown>, fallback: number): number {
  const value = args.limit ?? fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw new LembraError("paramNotPositive", { key: "limit" });
  return Math.min(value, 50);
}

function filtersOf(args: Record<string, unknown>): Filters {
  const since = text(args, "since");
  const until = text(args, "until");
  return {
    repo: text(args, "repo"),
    branch: text(args, "branch"),
    since: since ? parseDate(since) : undefined,
    until: until ? parseDate(until, true) : undefined,
  };
}

function sessionHeader(session: Session, locale: Locale): string {
  const t = MCP[locale];
  const header = t.header(
    session.title ?? t.untitled,
    session.id,
    repoName(session.repo),
    session.branch ?? t.noBranch,
    textFormat(locale).when(session.ended_at),
    session.prompt_count,
  );
  return session.source === "history" ? header + t.promptsOnly : header;
}

export const TOOLS: Tool[] = [
  {
    name: "search_history",
    description:
      "Searches every Claude Code session on this computer, across all repositories and including old ones: the user's prompts, Claude's replies, summaries and titles. Use it when the user asks whether they did something similar before, mentions a past session, decision, SQL or file, or when past context would help. Returns sessions with matching snippets; go deeper with get_session or handoff.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: 'Keywords. Each word matches as a prefix; use "quotes" for an exact phrase.' },
        ...FILTERS,
        prompts_only: { type: "boolean", description: "Search only what the user wrote" },
        limit: LIMIT,
      },
      required: ["query"],
    },
    run({ db, locale }, args) {
      const hits = search(db, text(args, "query", true)!, filtersOf(args), { promptsOnly: args.prompts_only === true, limit: limitOf(args, 10) });
      if (!hits.length) return MCP[locale].nothingFound;
      return hits
        .map((hit) => [sessionHeader(hit.session, locale), ...hit.snippets.map((s) => `> [${s.role}] ${bracketMatches(oneLine(s.text, 300))}`)].join("\n"))
        .join("\n\n");
    },
  },
  {
    name: "list_sessions",
    description: "Lists the most recent Claude Code sessions, filtered by repository, branch and period.",
    inputSchema: { type: "object", properties: { ...FILTERS, limit: LIMIT } },
    run({ db, locale }, args) {
      const t = MCP[locale];
      const sessions = listSessions(db, filtersOf(args), limitOf(args, 15));
      if (!sessions.length) return t.noSessions;
      return sessions.map((session) => `${sessionHeader(session, locale)}\n${t.lastRequest(oneLine(session.last_prompt, 200))}`).join("\n\n");
    },
  },
  {
    name: "get_session",
    description: "Shows one session: its summary, every user prompt (and Claude's replies when asked), /compact summaries and the files it touched with their ids.",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string", description: "Start of the session id, or the name given with /rename" },
        include_replies: { type: "boolean", description: "Include Claude's replies (longer)" },
        max_chars: { type: "integer", minimum: 1000, description: "Maximum answer length (default 20000)" },
      },
      required: ["session"],
    },
    run({ db, locale }, args) {
      const t = MCP[locale];
      const format = textFormat(locale);
      const session = findSession(db, text(args, "session", true)!);
      const parts = [sessionHeader(session, locale), t.folder(session.cwd ?? "?")];
      if (session.source === "transcript") parts.push(t.resume(resumeCommand(session)));
      if (session.digest) parts.push(`\n${t.summary}\n${session.digest}`);
      parts.push(`\n${t.conversation}`);
      for (const message of sessionMessages(db, session.id, { replies: args.include_replies === true })) {
        parts.push(`[${message.role} · ${format.when(message.ts)}] ${message.text}`);
      }
      const files = sessionFiles(db, session.id).filter((file) => isAbsolute(file.path));
      if (files.length) {
        parts.push(`\n${t.files}`);
        for (const file of files) parts.push(`#${file.id} ${file.kind} ${shortPath(file.path)}${isMissing(file) ? t.deleted : ""}`);
      }
      return clip(parts.join("\n"), typeof args.max_chars === "number" ? args.max_chars : 20_000);
    },
  },
  {
    name: "handoff",
    description: "Builds the handoff brief of a session (goal, latest requests, where it stopped, files) to continue that work in this conversation.",
    inputSchema: {
      type: "object",
      properties: { session: { type: "string", description: "Start of the session id, or the name given with /rename" } },
      required: ["session"],
    },
    run({ db, locale }, args) {
      return buildHandoff(db, findSession(db, text(args, "session", true)!), locale);
    },
  },
  {
    name: "list_files",
    description: "Lists files Claude created, edited or read in past sessions (latest version of each path), including those already deleted from disk.",
    inputSchema: {
      type: "object",
      properties: {
        term: { type: "string", description: "Part of the path (e.g. .sql, report)" },
        repo: FILTERS.repo,
        since: FILTERS.since,
        missing: { type: "boolean", description: "Only files that no longer exist on disk" },
        limit: LIMIT,
      },
    },
    run({ db, locale }, args) {
      const t = MCP[locale];
      const format = textFormat(locale);
      const since = text(args, "since");
      let files = latestFiles(db, { term: text(args, "term"), repo: text(args, "repo"), since: since ? parseDate(since) : undefined });
      if (args.missing === true) files = files.filter(isMissing);
      if (!files.length) return t.noFiles;
      return files
        .slice(0, limitOf(args, 20))
        .map((file) => `#${file.id} ${format.when(file.ts)} ${file.kind} ${repoName(file.repo)} ${shortPath(file.path)}${isMissing(file) ? t.deleted : ""}`)
        .join("\n");
    },
  },
  {
    name: "get_file",
    description: "Reads the stored content of a file from the vault, even if it was deleted from disk.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "File id (#123) or its original path" },
        max_chars: { type: "integer", minimum: 1000, description: "Maximum length (default 50000)" },
      },
      required: ["file"],
    },
    run({ db, locale }, args) {
      const t = MCP[locale];
      const file = resolveFile(db, text(args, "file", true)!);
      const data = readStoredFile(db, file);
      if (data.includes(0)) return t.binary(file.path, data.byteLength, file.id);
      const header = t.version(file.path, textFormat(locale).when(file.ts)) + (isMissing(file) ? t.restoreHint(file.id) : "");
      return `${header}\n\n${clip(new TextDecoder().decode(data), typeof args.max_chars === "number" ? args.max_chars : 50_000)}`;
    },
  },
  {
    name: "pending_work",
    description: "Lists branches with recent sessions whose work was not delivered: never pushed, unpushed commits, uncommitted changes or no PR.",
    inputSchema: { type: "object", properties: { since: { ...FILTERS.since, description: "Period analyzed (default 14d)" } } },
    async run({ db, services, locale }, args) {
      const t = MCP[locale];
      const items = await findPending(db, { since: parseDate(text(args, "since") ?? "14d"), probe: services.git });
      if (!items.length) return t.nothingPending;
      const format = textFormat(locale);
      return items
        .map((item) => t.pending(repoName(item.repo), item.branch, describeReasons(item, locale).join(", "), item.lastSession.id.slice(0, 8), format.when(item.lastSession.ended_at)))
        .join("\n");
    },
  },
];
