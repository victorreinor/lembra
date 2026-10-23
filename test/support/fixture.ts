import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Io } from "../../src/cli/commands";
import type { Services } from "../../src/core/services";
import type { Paths } from "../../src/core/paths";
import type { BranchFacts } from "../../src/core/pending";

export const SESSION = "11111111-2222-3333-4444-555555555555";
export const OTHER_SESSION = "11119999-2222-3333-4444-555555555555";
export const OLD_SESSION = "99999999-8888-7777-6666-555555555555";

// A throwaway ~/.claude plus data dir. `cwd` is the repo the sessions ran in; it is never created on disk.
export interface Fixture {
  root: string;
  paths: Paths;
  cwd: string;
  downloads: string;
  transcript: string;
  cleanup(): void;
}

export function createFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "lembra-test-"));
  const paths = { claudeDir: join(root, "claude"), dataDir: join(root, "lembra") };
  const cwd = join(root, "work", "billing-app");
  const downloads = join(root, "Downloads");
  const projectDir = join(paths.claudeDir, "projects", cwd.replaceAll("/", "-"));
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(downloads, { recursive: true });
  return {
    root,
    paths,
    cwd,
    downloads,
    transcript: join(projectDir, `${SESSION}.jsonl`),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

export function writeJsonl(path: string, records: object[]) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, records.map((record) => `${JSON.stringify(record)}\n`).join(""));
}

export function appendJsonl(path: string, records: object[]) {
  appendFileSync(path, records.map((record) => `${JSON.stringify(record)}\n`).join(""));
}

// Builders for the record shapes Claude Code writes (see docs/claude-code-data.md).
export function records(cwd: string, sessionId = SESSION) {
  const base = { sessionId, cwd, gitBranch: "fix/billing", userType: "external", entrypoint: "cli" };
  const user = (uuid: string, timestamp: string, extra: object) => ({ ...base, type: "user", uuid, timestamp, ...extra });
  return {
    prompt: (uuid: string, timestamp: string, content: unknown) =>
      user(uuid, timestamp, { promptSource: "typed", origin: { kind: "human" }, message: { role: "user", content } }),
    reply: (uuid: string, timestamp: string, text: string) => ({
      ...base,
      type: "assistant",
      uuid,
      timestamp,
      message: { role: "assistant", content: [{ type: "thinking", thinking: "…" }, { type: "text", text }] },
    }),
    toolResult: (uuid: string, timestamp: string, toolUseResult: object) =>
      user(uuid, timestamp, {
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: `toolu_${uuid}`, content: "ok" }] },
        toolUseResult,
      }),
    meta: (uuid: string, timestamp: string, content: string) => user(uuid, timestamp, { isMeta: true, message: { role: "user", content } }),
    notification: (uuid: string, timestamp: string, content: string) =>
      user(uuid, timestamp, { origin: { kind: "task-notification" }, message: { role: "user", content } }),
    compactSummary: (uuid: string, timestamp: string, text: string) =>
      user(uuid, timestamp, { isCompactSummary: true, message: { role: "user", content: text } }),
    // A message typed while Claude was still working.
    queued: (uuid: string, timestamp: string, prompt: string, extra: object = {}) => ({
      ...base,
      type: "attachment",
      uuid,
      timestamp,
      attachment: { type: "queued_command", prompt, commandMode: "prompt", origin: { kind: "human" }, humanTurn: true, timestamp, ...extra },
    }),
    aiTitle: (aiTitle: string) => ({ type: "ai-title", aiTitle, sessionId }),
    customTitle: (customTitle: string) => ({ type: "custom-title", customTitle, sessionId }),
    cost: (totalCostUSD: number, totalLinesAdded: number, totalLinesRemoved: number) => ({
      type: "cost-state",
      sessionId,
      totalCostUSD,
      totalLinesAdded,
      totalLinesRemoved,
    }),
    bookkeeping: () => ({ type: "api-request-blob", sessionId, hash: "abc", message: { model: "x" } }),
  };
}

// One realistic session: a prompt naming a file in Downloads, a reply, a written SQL file edited afterwards,
// a read outside the repo, and the noise (meta, notifications, slash-command output) that must be ignored.
export function seedBillingSession(f: Fixture) {
  const r = records(f.cwd);
  const report = join(f.downloads, "relatorio.sql");
  const fixSql = join(f.cwd, "fix.sql");
  const dump = join(f.downloads, "dump.sql");
  writeFileSync(report, "SELECT * FROM faturas;\n");
  writeJsonl(f.transcript, [
    { type: "permission-mode", permissionMode: "default", sessionId: SESSION },
    r.prompt("u1", "2026-10-01T10:00:00.000Z", `preciso corrigir o relatório de faturamento, veja ${report}.`),
    r.reply("a1", "2026-10-01T10:00:05.000Z", "Vou gerar o SQL de correção."),
    r.toolResult("u2", "2026-10-01T10:00:10.000Z", {
      type: "create",
      filePath: fixSql,
      content: "UPDATE faturas SET total = 1;\n",
      structuredPatch: [],
      originalFile: null,
    }),
    r.toolResult("u3", "2026-10-01T10:00:20.000Z", {
      filePath: fixSql,
      oldString: "total = 1",
      newString: "total = 2",
      originalFile: null,
      replaceAll: false,
      structuredPatch: [],
    }),
    r.toolResult("u4", "2026-10-01T10:00:30.000Z", {
      type: "text",
      file: { filePath: dump, content: "INSERT INTO faturas VALUES (1);", numLines: 1, startLine: 1, totalLines: 1 },
    }),
    r.meta("u5", "2026-10-01T10:00:40.000Z", "<local-command-caveat>Caveat: ignore</local-command-caveat>"),
    r.notification("u6", "2026-10-01T10:00:50.000Z", "<task-notification>done</task-notification>"),
    r.prompt("u7", "2026-10-01T10:01:00.000Z", "<local-command-stdout>Session renamed</local-command-stdout>"),
    r.bookkeeping(),
    r.aiTitle("Corrigir faturamento"),
    r.customTitle("billing-fix"),
    r.cost(1.25, 10, 2),
  ]);
  return { report, fixSql, dump };
}

export function seedOtherSession(f: Fixture) {
  const r = records(f.cwd, OTHER_SESSION);
  writeJsonl(join(dirname(f.transcript), `${OTHER_SESSION}.jsonl`), [
    { ...r.prompt("o1", "2026-10-05T15:00:00.000Z", "configurar fila SQS do worker"), gitBranch: "main" },
    { ...r.reply("o2", "2026-10-05T15:00:10.000Z", "Fila configurada."), gitBranch: "main" },
  ]);
}

export interface CapturedIo extends Io {
  stdout: string[];
  stderr: string[];
  bytes: Uint8Array[];
}

export function captureIo(): CapturedIo {
  const io: CapturedIo = {
    stdout: [],
    stderr: [],
    bytes: [],
    interactive: false,
    out: (line = "") => void io.stdout.push(line),
    err: (line) => void io.stderr.push(line),
    write: (data) => void io.bytes.push(data),
  };
  return io;
}

export const decode = (data: Uint8Array) => new TextDecoder().decode(data);

// Services that never touch git, gh or Claude: every call is recorded and answered from the given tables.
export function fakeServices(opts: { digest?: (prompt: string) => string; facts?: Record<string, BranchFacts> } = {}) {
  const prompts: string[] = [];
  const factsOf = (branch: string): BranchFacts => opts.facts?.[branch] ?? { exists: true, upstream: true, ahead: 0, dirty: false, pr: "MERGED" };
  const services: Services = {
    summarizer: () => async (prompt) => {
      prompts.push(prompt);
      return opts.digest?.(prompt) ?? "Corrigir o relatório de faturamento duplicado.\nSQL de correção em fix.sql.";
    },
    git: {
      root: async (cwd) => cwd,
      defaultBranch: async () => "main",
      facts: async (_root, branch) => factsOf(branch),
      pullRequests: async (_root, branches) => new Map(branches.map((branch) => [branch, factsOf(branch).pr])),
    },
  };
  return { services, prompts };
}
