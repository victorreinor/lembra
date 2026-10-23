import type { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { restoreTranscript } from "../core/archive";
import { LembraError } from "../core/errors";
import { isMissing, latestFiles, readStoredFile, resolveFile, restoreFile, sessionFiles, type StoredFile } from "../core/files";
import { buildHandoff } from "../core/handoff";
import { indexAll } from "../core/indexer";
import type { Paths } from "../core/paths";
import { describeReasons, findPending, type GitProbe } from "../core/pending";
import { parseDate, type Filters } from "../core/query";
import { search } from "../core/search";
import { findSession, listSessions, resumeCommand, sessionMessages, type Session } from "../core/sessions";
import { collectStats } from "../core/stats";
import { sessionsToSummarize, summarizeSession, type Runner } from "../core/summarize";
import { copyToClipboard } from "../system/os";
import { bold, bytes, count, cyan, dim, green, highlight, oneLine, red, repoName, shortPath, when, yellow } from "./format";

export interface Io {
  out(line?: string): void;
  err(line: string): void;
  write(data: Uint8Array): void;
  // A real terminal: `resume` may hand it over to claude.
  interactive: boolean;
}

// Side effects that reach outside the vault, injected so tests never call git, gh or Claude.
export interface Services {
  git: GitProbe;
  summarizer(model: string): Runner;
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
  help?: boolean;
}

export interface Context {
  db: Database;
  paths: Paths;
  options: Options;
  args: string[];
  io: Io;
  services: Services;
}

type Command = (ctx: Context) => number | void | Promise<number | void>;

const ROLE_MARK = { prompt: "›", reply: "‹", summary: "≡", digest: "∑" } as const;
const FILE_HINT = "lembra restore <#id> [--to caminho] · lembra cat <#id>";

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
};

function searchCommand({ db, options, args, io }: Context) {
  const query = args.join(" ").trim();
  if (!query) throw new LembraError("Diga o que procurar: lembra search <termos>");
  const hits = search(db, query, filtersFrom(options), { promptsOnly: options.prompts, limit: limitFrom(options, 15) });
  if (!hits.length) return io.out(dim("Nada encontrado."));
  for (const hit of hits) {
    io.out(sessionLine(hit.session));
    for (const snippet of hit.snippets) {
      io.out(`   ${ROLE_MARK[snippet.role]} ${dim(when(snippet.ts))}  ${highlight(oneLine(snippet.text, 200))}`);
    }
    io.out();
  }
  io.out(dim("lembra show <id> para detalhes · lembra resume <id> para continuar"));
}

function listCommand({ db, options, io }: Context) {
  const sessions = listSessions(db, filtersFrom(options), limitFrom(options, 20));
  if (!sessions.length) return io.out(dim("Nenhuma sessão."));
  for (const session of sessions) {
    io.out(sessionLine(session));
    io.out(dim(`   ${session.prompt_count} prompts · último: ${oneLine(session.last_prompt, 100)}`));
  }
}

function showCommand({ db, options, args, io }: Context) {
  const session = findSession(db, required(args[0], "a sessão"));
  io.out(bold(session.title ?? "(sem título)"));
  io.out(dim(`${session.id} · ${session.repo ?? "?"} · ${session.branch ?? "sem branch"} · ${shortPath(session.cwd ?? "?")}`));
  const cost = session.cost_usd ? ` · US$ ${session.cost_usd.toFixed(2)}` : "";
  const lines = session.lines_added != null ? ` · +${session.lines_added}/-${session.lines_removed ?? 0} linhas` : "";
  io.out(`${when(session.started_at)} → ${when(session.ended_at)} · ${session.prompt_count} prompts${cost}${lines}`);
  if (session.source === "history") io.out(yellow("Só os prompts: o Claude Code apagou o transcript antes do cofre existir."));
  else io.out(`Retomar: ${cyan(resumeCommand(session))}`);
  if (session.digest) io.out(`\n${bold("Resumo")}\n${session.digest}`);

  io.out(`\n${bold("Prompts")}`);
  let n = 0;
  for (const message of sessionMessages(db, session.id)) {
    const mark = message.role === "summary" ? yellow("  ≡ resumo do /compact") : `${String(++n).padStart(3)}.`;
    io.out(`${mark} ${dim(when(message.ts))}  ${options.full ? message.text : oneLine(message.text, 160)}`);
  }

  const files = sessionFiles(db, session.id);
  if (!files.length) return;
  io.out(`\n${bold("Arquivos")}`);
  for (const file of files) io.out(fileLine(file, false));
  io.out(dim(`\n${FILE_HINT}`));
}

async function resumeSessionCommand({ db, paths, options, args, io }: Context): Promise<number> {
  const session = findSession(db, required(args[0], "a sessão"));
  if (session.source === "history") {
    throw new LembraError(
      "O Claude Code apagou o transcript desta sessão antes do cofre existir, então não dá para retomá-la. Use lembra handoff para levar o contexto a uma sessão nova.",
    );
  }
  if ((await restoreTranscript(db, paths, session.id)) === "restored") io.err(dim("Transcript restaurado a partir do cofre."));
  const command = resumeCommand(session);
  const cwdExists = Boolean(session.cwd && existsSync(session.cwd));
  if (!cwdExists) io.err(yellow(`A pasta ${shortPath(session.cwd ?? "?")} não existe mais.`));
  if (options.print || !io.interactive || !cwdExists) {
    io.out(command);
    return 0;
  }
  io.err(dim(command));
  const child = Bun.spawn(["claude", "--resume", session.id], { cwd: session.cwd!, stdio: ["inherit", "inherit", "inherit"] });
  return await child.exited;
}

async function handoffCommand({ db, options, args, io }: Context) {
  const text = buildHandoff(db, findSession(db, required(args[0], "a sessão")));
  if (!options.copy) return io.out(text);
  await copyToClipboard(text);
  io.out(`${green("Copiado.")} Cole num terminal novo do Claude Code para continuar de onde parou.`);
}

function filesCommand({ db, options, args, io }: Context) {
  const since = options.since ? parseDate(options.since) : undefined;
  let files = latestFiles(db, { term: args.join(" ") || undefined, repo: options.repo, since });
  if (options.missing) files = files.filter(isMissing);
  const shown = files.slice(0, limitFrom(options, 30));
  if (!shown.length) return io.out(dim("Nenhum arquivo."));
  for (const file of shown) io.out(fileLine(file, true));
  if (files.length > shown.length) io.out(dim(`… e mais ${count(files.length - shown.length)} (use --limit)`));
  io.out(dim(`\n${FILE_HINT}`));
}

async function restoreCommand({ db, options, args, io }: Context) {
  const { file, dest } = await restoreFile(db, required(args[0], "o arquivo (#id ou caminho)"), { to: options.to, force: options.force });
  io.out(`${green("Restaurado")} ${shortPath(dest)} ${dim(`(${bytes(file.size ?? 0)}, versão de ${when(file.ts)})`)}`);
}

function catCommand({ db, args, io }: Context) {
  io.write(readStoredFile(db, resolveFile(db, required(args[0], "o arquivo (#id ou caminho)"))));
}

async function pendingCommand({ db, options, io, services }: Context) {
  io.err(dim("Consultando git e GitHub…"));
  const items = await findPending(db, { since: parseDate(options.since ?? "14d"), probe: services.git });
  if (!items.length) return io.out(green("Nada pendente: toda branch com sessão recente foi enviada e tem PR."));
  for (const item of items) {
    io.out(`${green(repoName(item.repo))} · ${bold(item.branch)}  ${yellow(describeReasons(item).join(" · "))}`);
    const last = item.lastSession;
    io.out(dim(`   ${item.sessions} sessões · última ${when(last.ended_at)} · ${last.id.slice(0, 8)} ${oneLine(last.title, 70)}`));
  }
}

async function summarizeCommand({ db, options, args, io, services }: Context): Promise<number> {
  const sessions = args[0] ? [findSession(db, args[0])] : sessionsToSummarize(db, { limit: limitFrom(options, 10) });
  if (!sessions.length) return io.out(dim("Nenhuma sessão nova para resumir.")) ?? 0;
  const model = options.model ?? "haiku";
  const runner = services.summarizer(model);
  io.err(dim(`Resumindo ${sessions.length} ${sessions.length === 1 ? "sessão" : "sessões"} com ${model}…`));
  let failed = 0;
  for (const session of sessions) {
    try {
      const digest = await summarizeSession(db, session, runner);
      io.out(`${green("✓")} ${cyan(session.id.slice(0, 8))} ${bold(oneLine(session.title, 60))}`);
      io.out(dim(`   ${oneLine(digest.split("\n")[0], 140)}`));
    } catch (error) {
      if (!(error instanceof LembraError)) throw error;
      failed++;
      io.err(`${red("✗")} ${session.id.slice(0, 8)} ${error.message}`);
    }
  }
  return failed ? 1 : 0;
}

async function indexCommand({ db, paths, io }: Context) {
  const started = performance.now();
  const stats = await indexAll(db, paths, { archive: true });
  const seconds = ((performance.now() - started) / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  io.out(`${green("Indexado")} em ${seconds}s`);
  io.out(`  ${count(stats.changed)} de ${count(stats.scanned)} transcripts com novidades`);
  io.out(`  ${count(stats.messages)} mensagens · ${count(stats.files)} arquivos · ${count(stats.history)} prompts antigos do history.jsonl`);
}

function statsCommand({ db, paths, io }: Context) {
  const stats = collectStats(db, paths);
  const retention = stats.retentionDays
    ? `${count(stats.retentionDays)} dias`
    : red("30 dias (padrão): o Claude Code apaga transcripts antigos. Rode lembra install ou configure cleanupPeriodDays.");
  const rows: [string, string][] = [
    ["Sessões", `${count(stats.sessions)} com transcript · ${count(stats.historyOnly)} só com prompts · desde ${when(stats.oldest)}`],
    ["Mensagens", `${count(stats.prompts)} prompts · ${count(stats.replies)} respostas · ${count(stats.summaries)} resumos de /compact`],
    ["Arquivos", `${count(stats.paths)} caminhos · ${count(stats.versions)} versões · ${count(stats.missing)} apagados do disco e recuperáveis`],
    ["Cofre", `${bytes(stats.dbBytes)} no banco · ${bytes(stats.rawBytes)} de transcripts brutos (zstd)`],
    ["Claude Code", `${bytes(stats.claudeBytes)} em ${shortPath(paths.claudeDir)} · retenção: ${retention}`],
  ];
  for (const [label, value] of rows) io.out(`${bold(label.padEnd(12))} ${value}`);
}

function sessionLine(session: Session): string {
  const where = [repoName(session.repo), session.branch].filter(Boolean).join(" · ");
  const partial = session.source === "history" ? yellow(" [só prompts]") : "";
  const title = bold(oneLine(session.title ?? "(sem título)", 70));
  return `${cyan(session.id.slice(0, 8))}  ${dim(when(session.ended_at))}  ${green(where)}  ${title}${partial}`;
}

function fileLine(file: StoredFile, showRepo: boolean): string {
  const status = !file.sha
    ? dim("sem conteúdo completo")
    : !isAbsolute(file.path)
      ? dim("imagem colada")
      : isMissing(file)
        ? red("apagado do disco")
        : dim("no disco");
  const repo = showRepo ? `${green(repoName(file.repo).padEnd(16))} ` : "";
  const versions = file.versions > 1 ? dim(` · ${file.versions} versões`) : "";
  return `${cyan(`#${file.id}`.padEnd(7))} ${dim(when(file.ts))}  ${file.kind.padEnd(5)}  ${repo}${shortPath(file.path)}  ${status}${versions}`;
}

function filtersFrom(options: Options): Filters {
  return {
    repo: options.repo,
    branch: options.branch,
    since: options.since ? parseDate(options.since) : undefined,
    until: options.until ? parseDate(options.until, true) : undefined,
  };
}

function limitFrom(options: Options, fallback: number): number {
  const limit = Number(options.limit ?? fallback);
  if (!Number.isInteger(limit) || limit <= 0) throw new LembraError(`--limit precisa ser um número positivo (recebi ${options.limit}).`);
  return limit;
}

function required(value: string | undefined, what: string): string {
  if (!value) throw new LembraError(`Informe ${what}. Veja: lembra --help`);
  return value;
}
