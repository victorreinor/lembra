import type { Database } from "bun:sqlite";
import { parseArgs } from "node:util";
import { openDb } from "../core/db";
import { LembraError } from "../core/errors";
import { indexAll } from "../core/indexer";
import { defaultPaths, type Paths } from "../core/paths";
import { systemGit } from "../core/pending";
import { claudeRunner } from "../core/summarize";
import { textFormat } from "../core/text";
import { CLI, type CliCatalog } from "../i18n/cli";
import { LOCALES, matchLocale } from "../i18n/locale";
import { preferredLocale } from "../i18n/system";
import { COMMANDS, SELF_INDEXING, type Io, type Options, type Services } from "./commands";
import { dim, red } from "./format";

const OPTIONS = {
  repo: { type: "string", short: "r" },
  branch: { type: "string", short: "b" },
  since: { type: "string" },
  until: { type: "string" },
  limit: { type: "string", short: "n" },
  prompts: { type: "boolean", short: "p" },
  missing: { type: "boolean" },
  full: { type: "boolean" },
  to: { type: "string" },
  force: { type: "boolean", short: "f" },
  print: { type: "boolean" },
  copy: { type: "boolean", short: "c" },
  model: { type: "string" },
  port: { type: "string" },
  serve: { type: "boolean" },
  "dry-run": { type: "boolean" },
  lang: { type: "string" },
  help: { type: "boolean", short: "h" },
} as const;

export const consoleIo: Io = {
  out: (line = "") => console.log(line),
  err: (line) => console.error(line),
  write: (data) => void process.stdout.write(data),
  interactive: Boolean(process.stdout.isTTY),
};

export function defaultServices(paths: Paths): Services {
  return { git: systemGit, summarizer: (model) => claudeRunner(paths, model) };
}

// Returns the process exit code; never calls process.exit, so tests can drive it directly.
export async function run(
  argv: string[],
  io: Io = consoleIo,
  paths: Paths = defaultPaths(),
  services: Services = defaultServices(paths),
): Promise<number> {
  let options: Options;
  let positionals: string[];
  try {
    ({ values: options, positionals } = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS }));
  } catch (error) {
    io.err(red((error as Error).message));
    io.err(dim(CLI[preferredLocale({ dataDir: paths.dataDir })].seeHelp));
    return 2;
  }

  const locale = preferredLocale({ flag: options.lang, dataDir: paths.dataDir });
  const t: CliCatalog = CLI[locale];
  if (options.lang && !matchLocale(options.lang)) {
    io.err(red(new LembraError("invalidLanguage", { value: options.lang, supported: LOCALES.join(", ") }).in(locale)));
    return 2;
  }
  if (options.help || positionals[0] === "help") {
    io.out(t.help);
    return 0;
  }

  let [name = "list", ...args] = positionals;
  if (!Object.hasOwn(COMMANDS, name)) {
    name = "search";
    args = positionals;
  }

  const db = openDb(paths.dataDir);
  try {
    if (!SELF_INDEXING.has(name)) await refresh(db, paths, io, t);
    return (await COMMANDS[name]!({ db, paths, options, args, io, services, locale, t, fmt: textFormat(locale) })) ?? 0;
  } catch (error) {
    if (!(error instanceof LembraError)) throw error;
    io.err(red(error.in(locale)));
    return 1;
  } finally {
    db.close();
  }
}

// Every read starts by picking up whatever Claude Code wrote since the last run (usually a few lines).
async function refresh(db: Database, paths: Paths, io: Io, t: CliCatalog) {
  const firstRun = !db.query("SELECT 1 FROM sources LIMIT 1").get();
  if (firstRun) io.err(dim(t.firstRun));
  await indexAll(db, paths, { archive: firstRun });
}
