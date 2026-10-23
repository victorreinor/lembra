import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// `lembra install` / `lembra uninstall`: each step checks before it changes anything, so running
// either command twice is safe. Everything that touches the system goes through InstallEnv.

export type Exec = (cmd: string[]) => Promise<{ code: number; out: string }>;

export const systemExec: Exec = async (cmd) => {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, out: `${out}${err}`.trim() };
};

export interface InstallEnv {
  home: string;
  claudeDir: string;
  dataDir: string;
  // Repository root: holds the plugin marketplace (.claude-plugin/marketplace.json).
  repoRoot: string;
  // Absolute path of src/cli/index.ts, the program launchd and the PATH link point to.
  cliEntry: string;
  bunPath: string;
  platform: NodeJS.Platform;
  // PATH baked into the launchd agents, so they find git, gh, claude and osascript.
  path: string;
  uid: number;
  exec: Exec;
  hasClaude: boolean;
}

export type StepStatus = "ok" | "changed" | "skipped" | "failed";

export interface StepResult {
  step: string;
  status: StepStatus;
  detail: string;
}

export const RETENTION_DAYS = 3650;
export const PLUGIN_ID = "lembra@lembra";
export const AGENTS = { server: "com.lembra.server", index: "com.lembra.index" } as const;
const DAILY_INDEX = { Hour: 12, Minute: 30 };

const linkPath = (env: InstallEnv) => join(env.home, ".local", "bin", "lembra");
const agentPath = (env: InstallEnv, label: string) => join(env.home, "Library", "LaunchAgents", `${label}.plist`);
const settingsPath = (env: InstallEnv) => join(env.claudeDir, "settings.json");

// ── launchd ─────────────────────────────────────────────────────────────

const xml = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export interface AgentSpec {
  label: string;
  args: string[];
  path: string;
  log: string;
  // Restart when it crashes (the web server), as opposed to a scheduled job.
  keepAlive?: boolean;
  calendar?: { Hour: number; Minute: number };
}

export function launchAgentPlist(spec: AgentSpec): string {
  const lines = [
    `  <key>Label</key><string>${xml(spec.label)}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    ...spec.args.map((arg) => `    <string>${xml(arg)}</string>`),
    "  </array>",
    "  <key>EnvironmentVariables</key>",
    `  <dict><key>PATH</key><string>${xml(spec.path)}</string></dict>`,
    `  <key>StandardOutPath</key><string>${xml(spec.log)}</string>`,
    `  <key>StandardErrorPath</key><string>${xml(spec.log)}</string>`,
    `  <key>RunAtLoad</key><${spec.keepAlive ? "true" : "false"}/>`,
  ];
  // Restart only after a crash: `ui --serve` exits 0 when another lembra already serves the port.
  if (spec.keepAlive) lines.push("  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>");
  if (spec.calendar) {
    lines.push(
      "  <key>StartCalendarInterval</key>",
      `  <dict><key>Hour</key><integer>${spec.calendar.Hour}</integer><key>Minute</key><integer>${spec.calendar.Minute}</integer></dict>`,
    );
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    ...lines,
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

function agentSpecs(env: InstallEnv): AgentSpec[] {
  const logs = join(env.dataDir, "logs");
  return [
    { label: AGENTS.server, args: [env.bunPath, env.cliEntry, "ui", "--serve"], path: env.path, log: join(logs, "server.log"), keepAlive: true },
    { label: AGENTS.index, args: [env.bunPath, env.cliEntry, "index"], path: env.path, log: join(logs, "index.log"), calendar: DAILY_INDEX },
  ];
}

// ── steps ───────────────────────────────────────────────────────────────

async function linkCommand(env: InstallEnv, dryRun: boolean): Promise<StepResult> {
  const step = "comando no PATH";
  const target = linkPath(env);
  const linked = existsSync(target) || isSymlink(target);
  if (linked) {
    if (isSymlink(target) && readlinkSync(target) === env.cliEntry) return { step, status: "ok", detail: `${target} → ${env.cliEntry}` };
    return { step, status: "skipped", detail: `${target} já existe e aponta para outro lugar; deixei como está` };
  }
  if (!dryRun) {
    mkdirSync(join(env.home, ".local", "bin"), { recursive: true });
    symlinkSync(env.cliEntry, target);
  }
  const onPath = env.path.split(":").includes(join(env.home, ".local", "bin"));
  return { step, status: "changed", detail: `${target} → ${env.cliEntry}${onPath ? "" : " (adicione ~/.local/bin ao PATH)"}` };
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

async function ensureRetention(env: InstallEnv, dryRun: boolean): Promise<StepResult> {
  const step = "retenção do Claude Code";
  const file = settingsPath(env);
  const settings = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  if (typeof settings.cleanupPeriodDays === "number" && settings.cleanupPeriodDays >= RETENTION_DAYS) {
    return { step, status: "ok", detail: `cleanupPeriodDays = ${settings.cleanupPeriodDays}` };
  }
  if (!dryRun) {
    if (existsSync(file)) copyFileSync(file, `${file}.lembra-backup`);
    mkdirSync(env.claudeDir, { recursive: true });
    writeFileSync(file, `${JSON.stringify({ ...settings, cleanupPeriodDays: RETENTION_DAYS }, null, 2)}\n`);
  }
  return { step, status: "changed", detail: `cleanupPeriodDays = ${RETENTION_DAYS} (backup em settings.json.lembra-backup)` };
}

async function installPlugin(env: InstallEnv, dryRun: boolean): Promise<StepResult> {
  const step = "plugin do Claude Code";
  if (!env.hasClaude) return { step, status: "skipped", detail: "o comando claude não está no PATH" };
  if (await pluginInstalled(env)) return { step, status: "ok", detail: `${PLUGIN_ID} instalado (MCP, hooks e /lembra:handoff)` };
  if (dryRun) return { step, status: "changed", detail: `instalaria ${PLUGIN_ID} a partir de ${env.repoRoot}` };
  const added = await env.exec(["claude", "plugin", "marketplace", "add", env.repoRoot]);
  if (added.code !== 0 && !/already/i.test(added.out)) return { step, status: "failed", detail: added.out };
  const installed = await env.exec(["claude", "plugin", "install", PLUGIN_ID, "--scope", "user"]);
  if (installed.code !== 0) return { step, status: "failed", detail: installed.out };
  return { step, status: "changed", detail: `${PLUGIN_ID} instalado; vale a partir da próxima sessão do Claude Code` };
}

async function pluginInstalled(env: InstallEnv): Promise<boolean> {
  const { code, out } = await env.exec(["claude", "plugin", "list", "--json"]);
  return code === 0 && out.includes(`"${PLUGIN_ID}"`);
}

async function installAgents(env: InstallEnv, dryRun: boolean): Promise<StepResult> {
  const step = "serviços em segundo plano";
  if (env.platform !== "darwin") return { step, status: "skipped", detail: "launchd só existe no macOS; rode lembra ui manualmente" };
  const specs = agentSpecs(env);
  const stale = specs.filter((spec) => !existsSync(agentPath(env, spec.label)) || readFileSync(agentPath(env, spec.label), "utf8") !== launchAgentPlist(spec));
  if (!stale.length) return { step, status: "ok", detail: "página em localhost:4747 e indexação diária às 12:30" };
  if (dryRun) return { step, status: "changed", detail: `criaria ${stale.map((spec) => spec.label).join(" e ")}` };
  mkdirSync(join(env.dataDir, "logs"), { recursive: true });
  mkdirSync(join(env.home, "Library", "LaunchAgents"), { recursive: true });
  for (const spec of stale) {
    const plist = agentPath(env, spec.label);
    writeFileSync(plist, launchAgentPlist(spec));
    await env.exec(["launchctl", "bootout", `gui/${env.uid}/${spec.label}`]);
    const loaded = await env.exec(["launchctl", "bootstrap", `gui/${env.uid}`, plist]);
    if (loaded.code !== 0) return { step, status: "failed", detail: `${spec.label}: ${loaded.out}` };
  }
  return { step, status: "changed", detail: "página em localhost:4747 (sobe no login) e indexação diária às 12:30" };
}

export async function install(env: InstallEnv, opts: { dryRun?: boolean } = {}): Promise<StepResult[]> {
  const dryRun = opts.dryRun ?? false;
  const results: StepResult[] = [];
  for (const step of [linkCommand, ensureRetention, installPlugin, installAgents]) results.push(await step(env, dryRun));
  return results;
}

// Undoes install, except the retention setting and the data in ~/.lembra (the point of lembra).
export async function uninstall(env: InstallEnv): Promise<StepResult[]> {
  const results: StepResult[] = [];

  if (env.platform === "darwin") {
    const removed: string[] = [];
    for (const label of Object.values(AGENTS)) {
      const plist = agentPath(env, label);
      if (!existsSync(plist)) continue;
      await env.exec(["launchctl", "bootout", `gui/${env.uid}/${label}`]);
      rmSync(plist);
      removed.push(label);
    }
    results.push({ step: "serviços em segundo plano", status: removed.length ? "changed" : "ok", detail: removed.length ? `removidos: ${removed.join(", ")}` : "nada instalado" });
  }

  if (env.hasClaude && (await pluginInstalled(env))) {
    const out = await env.exec(["claude", "plugin", "uninstall", PLUGIN_ID]);
    await env.exec(["claude", "plugin", "marketplace", "remove", "lembra"]);
    results.push({ step: "plugin do Claude Code", status: out.code === 0 ? "changed" : "failed", detail: out.code === 0 ? `${PLUGIN_ID} removido` : out.out });
  } else {
    results.push({ step: "plugin do Claude Code", status: "ok", detail: "não estava instalado" });
  }

  const target = linkPath(env);
  if (isSymlink(target) && readlinkSync(target) === env.cliEntry) {
    rmSync(target);
    results.push({ step: "comando no PATH", status: "changed", detail: `${target} removido` });
  } else {
    results.push({ step: "comando no PATH", status: "ok", detail: "nenhum link do lembra" });
  }
  return results;
}
