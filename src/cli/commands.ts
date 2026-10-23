import type { Database } from "bun:sqlite";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { restoreTranscript } from "../core/archive";
import { readConfig, writeConfig } from "../core/config";
import { LembraError } from "../core/errors";
import { forEachLimited } from "../core/exec";
import { fileStatus, latestFiles, readStoredFile, resolveFile, restoreFile, sessionFiles, type StoredFile } from "../core/files";
import { buildHandoff } from "../core/handoff";
import { indexAll } from "../core/indexer";
import type { Paths } from "../core/paths";
import { describeReasons, findPending } from "../core/pending";
import { parseFilters } from "../core/query";
import { search } from "../core/search";
import type { Services } from "../core/services";
import { findSession, listSessions, resumeCommand, sessionMessages, type Session } from "../core/sessions";
import { collectStats } from "../core/stats";
import { sessionsToSummarize, summarizeSession } from "../core/summarize";
import { oneLine, repoName, shortPath, type TextFormat } from "../core/text";
import { CLI, type CliCatalog } from "../i18n/cli";
import { LOCALES, matchLocale, type Locale } from "../i18n/locale";
import { localeChoice, preferredLocale } from "../i18n/system";
import { createMcpHandler, serveStdio } from "../mcp/server";
import { install, systemExec, uninstall, type InstallEnv, type StepResult, type StepStatus } from "../system/install";
import { copyToClipboard, openUrl } from "../system/os";
import { VERSION } from "../version";
import { DEFAULT_PORT } from "../web/port";
import { bold, cyan, dim, green, highlight, red, yellow } from "./format";

export type { Services } from "../core/services";

export interface Io {
  out(line?: string): void;
  err(line: string): void;
  write(data: Uint8Array): void;
  // A real terminal: `resume` may hand it over to claude.
  interactive: boolean;
}

export interface Options {
  repo?: string;
  branch?: string;
  since?: string;
  until?: string;
  limit?: string;
  prompts?: boolean;
  missing?: boolean;
  full?: boolean;
  to?: string;
  force?: boolean;
  print?: boolean;
  copy?: boolean;
  model?: string;
  port?: string;
  serve?: boolean;
  "dry-run"?: boolean;
  lang?: string;
  help?: boolean;
}

export interface Context {
  db: Database;
  paths: Paths;
  options: Options;
  args: string[];
  io: Io;
  services: Services;
  locale: Locale;
  t: CliCatalog;
  fmt: TextFormat;
}

type Command = (ctx: Context) => number | void | Promise<number | void>;

const SUMMARY_CONCURRENCY = 3;
const ROLE_MARK = { prompt: "›", reply: "‹", summary: "≡", digest: "∑" } as const;
const STEP_MARK: Record<StepStatus, string> = { ok: green("✓"), changed: cyan("●"), skipped: yellow("–"), failed: red("✗") };

export const COMMANDS: Record<string, Command> = {
  search: searchCommand,
  list: listCommand,
  show: showCommand,
  resume: resumeSessionCommand,
  handoff: handoffCommand,
  files: filesCommand,
  restore: restoreCommand,
  cat: catCommand,
  pending: pendingCommand,
  summarize: summarizeCommand,
  index: indexCommand,
  stats: statsCommand,
  lang: langCommand,
  ui: uiCommand,
  install: installCommand,
  uninstall: uninstallCommand,
  mcp: mcpCommand,
  hook: hookCommand,
};

// Commands that manage indexing themselves instead of the automatic refresh before each read.
export const SELF_INDEXING = new Set(["index", "lang", "ui", "install", "uninstall", "mcp", "hook"]);

// ── find and resume ─────────────────────────────────────────────────────

function searchCommand(ctx: Context) {
  const { db, options, args, io, t, fmt } = ctx;
  const query = args.join(" ").trim();
  if (!query) throw new LembraError("missingQuery");
  const hits = search(db, query, parseFilters(options), { promptsOnly: options.prompts, limit: limitFrom(options, 15) });
  if (!hits.length) return io.out(dim(t.search.none));
  for (const hit of hits) {
    io.out(sessionLine(ctx, hit.session));
    for (const snippet of hit.snippets) io.out(`   ${ROLE_MARK[snippet.role]} ${dim(fmt.when(snippet.ts))}  ${highlight(oneLine(snippet.text, 200))}`);
    io.out();
  }
  io.out(dim(t.search.hint));
}

function listCommand(ctx: Context) {
  const { db, options, io, t, fmt } = ctx;
  const sessions = listSessions(db, parseFilters(options), limitFrom(options, 20));
  if (!sessions.length) return io.out(dim(t.list.none));
  for (const session of sessions) {
    io.out(sessionLine(ctx, session));
    io.out(dim(`   ${t.list.last(t.prompts(fmt.count(session.prompt_count), session.prompt_count), oneLine(session.last_prompt, 100))}`));
  }
}

function showCommand(ctx: Context) {
  const { db, options, args, io, t, fmt } = ctx;
  const session = findSession(db, required(args[0], "missingSession"));
  io.out(bold(session.title ?? t.untitled));
  io.out(dim(`${session.id} · ${session.repo ?? "?"} · ${session.branch ?? t.show.noBranch} · ${shortPath(session.cwd ?? "?")}`));
  const facts = [
    `${fmt.when(session.started_at)} → ${fmt.when(session.ended_at)}`,
    t.prompts(fmt.count(session.prompt_count), session.prompt_count),
    session.cost_usd ? t.show.cost(session.cost_usd.toFixed(2)) : null,
    session.lines_added != null ? t.show.lines(session.lines_added, session.lines_removed ?? 0) : null,
  ];
  io.out(facts.filter(Boolean).join(" · "));
  const command = resumeCommand(session);
  io.out(command ? `${t.show.resume} ${cyan(command)}` : yellow(t.show.promptsOnly));
  if (session.digest) io.out(`\n${bold(t.show.summary)}\n${session.digest}`);

  io.out(`\n${bold(t.show.prompts)}`);
  let n = 0;
  for (const message of sessionMessages(db, session.id, { maxChars: options.full ? undefined : 1000 })) {
    const mark = message.role === "summary" ? yellow(`  ${t.show.compact}`) : `${String(++n).padStart(3)}.`;
    io.out(`${mark} ${dim(fmt.when(message.ts))}  ${options.full ? message.text : oneLine(message.text, 160)}`);
  }

  const files = sessionFiles(db, session.id);
  if (!files.length) return;
  io.out(`\n${bold(t.show.files)}`);
  for (const file of files) io.out(fileLine(ctx, file, false));
  io.out(dim(`\n${t.fileHint}`));
}

async function resumeSessionCommand({ db, paths, options, args, io, t }: Context): Promise<number> {
  const session = findSession(db, required(args[0], "missingSession"));
  const command = resumeCommand(session);
  if (!command) throw new LembraError("promptsOnly");
  if ((await restoreTranscript(db, paths, session.id)) === "restored") io.err(dim(t.resume.restored));
  const cwdExists = Boolean(session.cwd && existsSync(session.cwd));
  if (!cwdExists) io.err(yellow(t.resume.folderGone(shortPath(session.cwd ?? "?"))));
  if (options.print || !io.interactive || !cwdExists) {
    io.out(command);
    return 0;
  }
  io.err(dim(command));
  const child = Bun.spawn(["claude", "--resume", session.id], { cwd: session.cwd!, stdio: ["inherit", "inherit", "inherit"] });
  return await child.exited;
}

async function handoffCommand({ db, options, args, io, t, locale }: Context) {
  const text = buildHandoff(db, findSession(db, required(args[0], "missingSession")), locale);
  if (!options.copy) return io.out(text);
  await copyToClipboard(text);
  io.out(green(t.handoff.copied));
}

// ── files ───────────────────────────────────────────────────────────────

function filesCommand(ctx: Context) {
  const { db, options, args, io, t, fmt } = ctx;
  const { repo, since } = parseFilters(options);
  const files = latestFiles(db, { term: args.join(" ") || undefined, repo, since, missing: options.missing });
  const shown = files.slice(0, limitFrom(options, 30));
  if (!shown.length) return io.out(dim(t.files.none));
  for (const file of shown) io.out(fileLine(ctx, file, true));
  if (files.length > shown.length) io.out(dim(t.files.more(fmt.count(files.length - shown.length))));
  io.out(dim(`\n${t.fileHint}`));
}

async function restoreCommand({ db, options, args, io, t, fmt }: Context) {
  const { file, dest } = await restoreFile(db, required(args[0], "missingFile"), { to: options.to, force: options.force });
  io.out(`${green(t.restore.done)} ${shortPath(dest)} ${dim(t.restore.detail(fmt.bytes(file.size ?? 0), fmt.when(file.ts)))}`);
}

function catCommand({ db, args, io }: Context) {
  io.write(readStoredFile(db, resolveFile(db, required(args[0], "missingFile"))));
}

// ── follow-up ───────────────────────────────────────────────────────────

async function pendingCommand({ db, options, io, services, t, fmt, locale }: Context) {
  io.err(dim(t.pending.checking));
  const items = await findPending(db, { since: options.since, probe: services.git });
  if (!items.length) return io.out(green(t.pending.none));
  for (const item of items) {
    io.out(`${green(repoName(item.repo))} · ${bold(item.branch)}  ${yellow(describeReasons(item, locale).join(" · "))}`);
    const last = item.lastSession;
    io.out(dim(`   ${t.pending.last(item.sessions, fmt.when(last.ended_at))} · ${last.id.slice(0, 8)} ${oneLine(last.title, 70)}`));
  }
}

async function summarizeCommand({ db, options, args, io, services, t, locale }: Context): Promise<number> {
  const sessions = args[0] ? [findSession(db, args[0])] : sessionsToSummarize(db, { limit: limitFrom(options, 10) });
  if (!sessions.length) {
    io.out(dim(t.summarize.none));
    return 0;
  }
  const model = options.model ?? "haiku";
  const runner = services.summarizer(model);
  io.err(dim(t.summarize.running(sessions.length, model)));
  let failed = 0;
  // A few claude -p runs at once: each mostly waits on the network.
  await forEachLimited(sessions, SUMMARY_CONCURRENCY, async (session) => {
    try {
      const digest = await summarizeSession(db, session, runner, locale);
      io.out(`${green("✓")} ${cyan(session.id.slice(0, 8))} ${bold(oneLine(session.title, 60))}\n${dim(`   ${oneLine(digest.split("\n")[0], 140)}`)}`);
    } catch (error) {
      if (!(error instanceof LembraError)) throw error;
      failed++;
      io.err(`${red("✗")} ${session.id.slice(0, 8)} ${error.in(locale)}`);
    }
  });
  return failed ? 1 : 0;
}

// ── maintenance ─────────────────────────────────────────────────────────

async function indexCommand({ db, paths, io, t, fmt }: Context) {
  const started = performance.now();
  const stats = await indexAll(db, paths, { archive: true });
  const seconds = ((performance.now() - started) / 1000).toLocaleString(fmt.locale, { maximumFractionDigits: 1 });
  io.out(green(t.index.done(seconds)));
  io.out(`  ${t.index.changed(fmt.count(stats.changed), fmt.count(stats.scanned))}`);
  io.out(`  ${t.index.counts(fmt.count(stats.messages), fmt.count(stats.files), fmt.count(stats.history))}`);
}

function statsCommand({ db, paths, io, t, fmt }: Context) {
  const stats = collectStats(db, paths);
  const retention = stats.retentionDays ? t.stats.days(fmt.count(stats.retentionDays)) : red(t.stats.defaultRetention);
  const rows: [string, string][] = [
    [t.stats.sessions.label, t.stats.sessions.value(fmt.count(stats.sessions), fmt.count(stats.historyOnly), fmt.when(stats.oldest))],
    [t.stats.messages.label, t.stats.messages.value(fmt.count(stats.prompts), fmt.count(stats.replies), fmt.count(stats.summaries))],
    [t.stats.files.label, t.stats.files.value(fmt.count(stats.paths), fmt.count(stats.versions), fmt.count(stats.missing))],
    [t.stats.vault.label, t.stats.vault.value(fmt.bytes(stats.dbBytes), fmt.bytes(stats.rawBytes))],
    [t.stats.claude.label, t.stats.claude.value(fmt.bytes(stats.claudeBytes), shortPath(paths.claudeDir), retention)],
    [t.stats.security.label, t.stats.security.value(fmt.count(stats.maskedMessages), fmt.count(stats.secretFiles))],
  ];
  for (const [label, value] of rows) io.out(`${bold(label.padEnd(12))} ${value}`);
}

// `lembra lang` shows the language and where it comes from; `lembra lang <code|auto>` stores it.
function langCommand({ paths, options, args, io, t, locale }: Context): number {
  const value = args[0];
  if (!value) {
    const { source } = localeChoice({ flag: options.lang, dataDir: paths.dataDir });
    io.out(t.lang.current(locale, t.lang.sources[source]));
    io.out(dim(t.lang.available(LOCALES.join(", "))));
    return 0;
  }
  const config = readConfig(paths.dataDir);
  if (value === "auto") {
    delete config.lang;
    writeConfig(paths.dataDir, config);
    // Confirm in the language that now applies.
    io.out(green(CLI[preferredLocale({ dataDir: paths.dataDir })].lang.auto));
    return 0;
  }
  const chosen = matchLocale(value);
  if (!chosen) throw new LembraError("invalidLanguage", { value, supported: `${LOCALES.join(", ")}, auto` });
  writeConfig(paths.dataDir, { ...config, lang: chosen });
  io.out(green(CLI[chosen].lang.set(chosen)));
  return 0;
}

// ── setup ───────────────────────────────────────────────────────────────

function installEnv(paths: Paths, locale: Locale): InstallEnv {
  const cliEntry = realpathSync(join(import.meta.dir, "index.ts"));
  return {
    home: homedir(),
    claudeDir: paths.claudeDir,
    dataDir: paths.dataDir,
    repoRoot: join(dirname(cliEntry), "..", ".."),
    cliEntry,
    bunPath: process.execPath,
    platform: process.platform,
    path: process.env.PATH ?? "/usr/bin:/bin",
    lang: process.env.LANG ?? (locale === "pt-BR" ? "pt_BR.UTF-8" : undefined),
    uid: process.getuid?.() ?? 0,
    exec: systemExec,
    hasClaude: Boolean(Bun.which("claude")),
  };
}

function printSteps({ io, t }: Context, results: StepResult[]) {
  for (const result of results) io.out(`${STEP_MARK[result.status]} ${bold(t.install.steps[result.step].padEnd(26))} ${dim(result.detail)}`);
}

// One command to set everything up: PATH link, retention, plugin (MCP + hooks + skills), launchd, first index.
async function installCommand(ctx: Context): Promise<number> {
  const { db, paths, options, io, t, fmt, locale } = ctx;
  const results = await install(installEnv(paths, locale), t.install, { dryRun: options["dry-run"] });
  printSteps(ctx, results);
  if (options["dry-run"]) {
    io.out(dim(`\n${t.install.dryRun}`));
    return 0;
  }
  const stats = await indexAll(db, paths, { archive: true });
  printSteps(ctx, [{ step: "index", status: "ok", detail: t.install.indexed(fmt.count(stats.scanned), fmt.count(stats.messages)) }]);
  io.out(`\n${bold(t.install.ready(cyan(`http://localhost:${DEFAULT_PORT}`), cyan("lembra ui")))}`);
  io.out(dim(t.install.next));
  return results.some((result) => result.status === "failed") ? 1 : 0;
}

async function uninstallCommand(ctx: Context): Promise<number> {
  const { paths, io, t, locale } = ctx;
  const results = await uninstall(installEnv(paths, locale), t.install);
  printSteps(ctx, results);
  io.out(dim(`\n${t.install.dataKept(shortPath(paths.dataDir))}`));
  return results.some((result) => result.status === "failed") ? 1 : 0;
}

// Opens the web page, starting the local server unless one (launchd or another terminal) already runs.
async function uiCommand({ db, paths, options, io, services, t, locale }: Context): Promise<number> {
  const { isServerRunning, startServer } = await import("../web/server");
  const port = Number(options.port ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port <= 0) throw new LembraError("invalidPort", { value: String(options.port) });
  const url = `http://localhost:${port}`;
  if (await isServerRunning(port)) {
    // Exit 0 so launchd (KeepAlive on failure only) does not keep retrying while another lembra serves.
    if (options.serve) {
      io.out(dim(t.ui.nothingToDo(url)));
      return 0;
    }
    openUrl(url);
    io.out(`${green(t.ui.opened(url))} ${dim(t.ui.alreadyRunning)}`);
    return 0;
  }
  startServer({ db, paths, services, port, locale: options.lang ? locale : undefined });
  io.out(`${green(t.ui.serving(cyan(url)))} ${dim(t.ui.stop)}`);
  if (!options.serve) openUrl(url);
  return new Promise<number>(() => {}); // serves until the process is stopped
}

// ── used by the Claude Code plugin ──────────────────────────────────────

// Started by Claude Code (plugin .mcp.json). Each tool call refreshes the index first.
async function mcpCommand({ db, paths, services, locale }: Context) {
  const refresh = async () => void (await indexAll(db, paths));
  await serveStdio(createMcpHandler({ db, paths, services, locale, version: VERSION, refresh }));
}

// Run by Claude Code's SessionEnd and PreCompact hooks: index and archive what just happened.
// Always exits 0, so a hiccup here never disturbs the session.
async function hookCommand({ db, paths, io, t }: Context) {
  try {
    await indexAll(db, paths, { archive: true });
  } catch (error) {
    io.err(t.hookFailed((error as Error).message));
  }
  return 0;
}

// ── shared formatting ───────────────────────────────────────────────────

function sessionLine({ t, fmt }: Context, session: Session): string {
  const where = [repoName(session.repo), session.branch].filter(Boolean).join(" · ");
  const partial = session.source === "history" ? yellow(` ${t.promptsOnlyBadge}`) : "";
  const title = bold(oneLine(session.title ?? t.untitled, 70));
  return `${cyan(session.id.slice(0, 8))}  ${dim(fmt.when(session.ended_at))}  ${green(where)}  ${title}${partial}`;
}

function fileLine({ t, fmt }: Context, file: StoredFile, showRepo: boolean): string {
  const status = fileStatus(file);
  const label = (status === "missing" ? red : dim)(t.fileStatus[status]);
  const repo = showRepo ? `${green(repoName(file.repo).padEnd(16))} ` : "";
  const versions = file.versions > 1 ? dim(` · ${t.versions(fmt.count(file.versions))}`) : "";
  return `${cyan(`#${file.id}`.padEnd(7))} ${dim(fmt.when(file.ts))}  ${file.kind.padEnd(5)}  ${repo}${shortPath(file.path)}  ${label}${versions}`;
}

function limitFrom(options: Options, fallback: number): number {
  const limit = Number(options.limit ?? fallback);
  if (!Number.isInteger(limit) || limit <= 0) throw new LembraError("invalidLimit", { value: String(options.limit) });
  return limit;
}

function required(value: string | undefined, error: "missingSession" | "missingFile"): string {
  if (!value) throw new LembraError(error);
  return value;
}
