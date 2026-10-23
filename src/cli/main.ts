import type { Database } from "bun:sqlite";
import { parseArgs } from "node:util";
import { openDb } from "../core/db";
import { LembraError } from "../core/errors";
import { indexAll } from "../core/indexer";
import { defaultPaths, type Paths } from "../core/paths";
import { systemGit } from "../core/pending";
import { claudeRunner } from "../core/summarize";
import { COMMANDS, type Io, type Options, type Services } from "./commands";
import { dim, red } from "./format";
import { HELP } from "./help";

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
    io.err(dim("Veja: lembra --help"));
    return 2;
  }
  if (options.help || positionals[0] === "help") {
    io.out(HELP);
    return 0;
  }

  let [name = "list", ...args] = positionals;
  if (!Object.hasOwn(COMMANDS, name)) {
    name = "search";
    args = positionals;
  }

  const db = openDb(paths.dataDir);
  try {
    if (name !== "index") await refresh(db, paths, io);
    return (await COMMANDS[name]!({ db, paths, options, args, io, services })) ?? 0;
  } catch (error) {
    if (!(error instanceof LembraError)) throw error;
    io.err(red(error.message));
    return 1;
  } finally {
    db.close();
  }
}

// Every read starts by picking up whatever Claude Code wrote since the last run (usually a few lines).
async function refresh(db: Database, paths: Paths, io: Io) {
  const firstRun = !db.query("SELECT 1 FROM sources LIMIT 1").get();
  if (firstRun) io.err(dim("Primeira indexação do histórico; pode levar um minuto…"));
  await indexAll(db, paths, { archive: firstRun });
}
