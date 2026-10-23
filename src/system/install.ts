import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CliCatalog } from "../i18n/cli";

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
  // Environment baked into the launchd agents, so they find git, gh, claude and osascript.
  path: string;
  lang?: string;
  uid: number;
  exec: Exec;
  hasClaude: boolean;
}

export type StepId = keyof CliCatalog["install"]["steps"];
export type StepStatus = "ok" | "changed" | "skipped" | "failed";

export interface StepResult {
  step: StepId;
  status: StepStatus;
  detail: string;
}

type Text = CliCatalog["install"];

export const RETENTION_DAYS = 3650;
export const PLUGIN_ID = "lembra@lembra";
export const AGENTS = { server: "com.lembra.server", index: "com.lembra.index" } as const;
const DAILY_INDEX = { Hour: 12, Minute: 30 };
const BOOTSTRAP_RETRIES = 15;
const BOOTSTRAP_RETRY_MS = 400;

const linkPath = (env: InstallEnv) => join(env.home, ".local", "bin", "lembra");
const agentPath = (env: InstallEnv, label: string) => join(env.home, "Library", "LaunchAgents", `${label}.plist`);
const settingsPath = (env: InstallEnv) => join(env.claudeDir, "settings.json");

// ── launchd ─────────────────────────────────────────────────────────────

const xml = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export interface AgentSpec {
  label: string;
  args: string[];
  env: Record<string, string>;
  log: string;
  // Restart when it crashes (the web server), as opposed to a scheduled job.
  keepAlive?: boolean;
  calendar?: { Hour: number; Minute: number };
}

export function launchAgentPlist(spec: AgentSpec): string {
  const env = Object.entries(spec.env).map(([key, value]) => `<key>${xml(key)}</key><string>${xml(value)}</string>`);
  const lines = [
    `  <key>Label</key><string>${xml(spec.label)}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    ...spec.args.map((arg) => `    <string>${xml(arg)}</string>`),
    "  </array>",
    "  <key>EnvironmentVariables</key>",
    `  <dict>${env.join("")}</dict>`,
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
  const vars: Record<string, string> = { PATH: env.path };
  if (env.lang) vars.LANG = env.lang;
  return [
    { label: AGENTS.server, args: [env.bunPath, env.cliEntry, "ui", "--serve"], env: vars, log: join(logs, "server.log"), keepAlive: true },
    { label: AGENTS.index, args: [env.bunPath, env.cliEntry, "index"], env: vars, log: join(logs, "index.log"), calendar: DAILY_INDEX },
  ];
}

// ── steps ───────────────────────────────────────────────────────────────

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

async function linkCommand(env: InstallEnv, t: Text, dryRun: boolean): Promise<StepResult> {
  const target = linkPath(env);
  if (existsSync(target) || isSymlink(target)) {
    if (isSymlink(target) && readlinkSync(target) === env.cliEntry) return { step: "link", status: "ok", detail: t.linkOk(target, env.cliEntry) };
    return { step: "link", status: "skipped", detail: t.linkForeign(target) };
  }
  if (!dryRun) {
    mkdirSync(join(env.home, ".local", "bin"), { recursive: true });
    symlinkSync(env.cliEntry, target);
  }
  const onPath = env.path.split(":").includes(join(env.home, ".local", "bin"));
  return { step: "link", status: "changed", detail: t.linkOk(target, env.cliEntry) + (onPath ? "" : t.linkAddPath) };
}

async function ensureRetention(env: InstallEnv, t: Text, dryRun: boolean): Promise<StepResult> {
  const file = settingsPath(env);
  const settings = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  if (typeof settings.cleanupPeriodDays === "number" && settings.cleanupPeriodDays >= RETENTION_DAYS) {
    return { step: "retention", status: "ok", detail: t.retentionOk(settings.cleanupPeriodDays) };
  }
  if (!dryRun) {
    if (existsSync(file)) copyFileSync(file, `${file}.lembra-backup`);
    mkdirSync(env.claudeDir, { recursive: true });
    writeFileSync(file, `${JSON.stringify({ ...settings, cleanupPeriodDays: RETENTION_DAYS }, null, 2)}\n`);
  }
  return { step: "retention", status: "changed", detail: t.retentionSet(RETENTION_DAYS) };
}

async function pluginInstalled(env: InstallEnv): Promise<boolean> {
  const { code, out } = await env.exec(["claude", "plugin", "list", "--json"]);
  return code === 0 && out.includes(`"${PLUGIN_ID}"`);
}

async function installPlugin(env: InstallEnv, t: Text, dryRun: boolean): Promise<StepResult> {
  if (!env.hasClaude) return { step: "plugin", status: "skipped", detail: t.noClaude };
  if (await pluginInstalled(env)) return { step: "plugin", status: "ok", detail: t.pluginOk(PLUGIN_ID) };
  if (dryRun) return { step: "plugin", status: "changed", detail: t.pluginWould(PLUGIN_ID, env.repoRoot) };
  const added = await env.exec(["claude", "plugin", "marketplace", "add", env.repoRoot]);
  if (added.code !== 0 && !/already/i.test(added.out)) return { step: "plugin", status: "failed", detail: added.out };
  const installed = await env.exec(["claude", "plugin", "install", PLUGIN_ID, "--scope", "user"]);
  if (installed.code !== 0) return { step: "plugin", status: "failed", detail: installed.out };
  return { step: "plugin", status: "changed", detail: t.pluginInstalled(PLUGIN_ID) };
}

async function installAgents(env: InstallEnv, t: Text, dryRun: boolean): Promise<StepResult> {
  if (env.platform !== "darwin") return { step: "agents", status: "skipped", detail: t.agentsNotMac };
  // An agent needs work when its plist is missing or outdated, or when launchd does not have it loaded.
  const stale: AgentSpec[] = [];
  for (const spec of agentSpecs(env)) {
    const plist = agentPath(env, spec.label);
    const current = existsSync(plist) && readFileSync(plist, "utf8") === launchAgentPlist(spec);
    const loaded = (await env.exec(["launchctl", "print", `gui/${env.uid}/${spec.label}`])).code === 0;
    if (!current || !loaded) stale.push(spec);
  }
  if (!stale.length) return { step: "agents", status: "ok", detail: t.agentsOk };
  if (dryRun) return { step: "agents", status: "changed", detail: t.agentsWould(stale.map((spec) => spec.label).join(", ")) };
  mkdirSync(join(env.dataDir, "logs"), { recursive: true });
  mkdirSync(join(env.home, "Library", "LaunchAgents"), { recursive: true });
  for (const spec of stale) {
    const plist = agentPath(env, spec.label);
    writeFileSync(plist, launchAgentPlist(spec));
    await env.exec(["launchctl", "bootout", `gui/${env.uid}/${spec.label}`]);
    // bootout finishes asynchronously; bootstrapping before the old instance is gone fails with EIO.
    let loaded = await env.exec(["launchctl", "bootstrap", `gui/${env.uid}`, plist]);
    for (let attempt = 0; loaded.code !== 0 && attempt < BOOTSTRAP_RETRIES; attempt++) {
      await Bun.sleep(BOOTSTRAP_RETRY_MS);
      loaded = await env.exec(["launchctl", "bootstrap", `gui/${env.uid}`, plist]);
    }
    if (loaded.code !== 0) return { step: "agents", status: "failed", detail: `${spec.label}: ${loaded.out}` };
  }
  return { step: "agents", status: "changed", detail: t.agentsInstalled };
}

export async function install(env: InstallEnv, t: Text, opts: { dryRun?: boolean } = {}): Promise<StepResult[]> {
  const dryRun = opts.dryRun ?? false;
  const results: StepResult[] = [];
  for (const step of [linkCommand, ensureRetention, installPlugin, installAgents]) results.push(await step(env, t, dryRun));
  return results;
}

// Undoes install, except the retention setting and the data in ~/.lembra (the point of lembra).
export async function uninstall(env: InstallEnv, t: Text): Promise<StepResult[]> {
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
    results.push({ step: "agents", status: removed.length ? "changed" : "ok", detail: removed.length ? t.agentsRemoved(removed.join(", ")) : t.nothingInstalled });
  }

  if (env.hasClaude && (await pluginInstalled(env))) {
    const out = await env.exec(["claude", "plugin", "uninstall", PLUGIN_ID]);
    await env.exec(["claude", "plugin", "marketplace", "remove", "lembra"]);
    results.push({ step: "plugin", status: out.code === 0 ? "changed" : "failed", detail: out.code === 0 ? t.pluginRemoved(PLUGIN_ID) : out.out });
  } else {
    results.push({ step: "plugin", status: "ok", detail: t.pluginAbsent });
  }

  const target = linkPath(env);
  if (isSymlink(target) && readlinkSync(target) === env.cliEntry) {
    rmSync(target);
    results.push({ step: "link", status: "changed", detail: t.linkRemoved(target) });
  } else {
    results.push({ step: "link", status: "ok", detail: t.noLink });
  }
  return results;
}
