import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLI } from "../../src/i18n/cli";
import { AGENTS, install, launchAgentPlist, PLUGIN_ID, uninstall, type InstallEnv } from "../../src/system/install";

const t = CLI.en.install;

let root: string;
let env: InstallEnv;
let commands: string[];
let pluginListed: boolean;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lembra-install-"));
  commands = [];
  pluginListed = false;
  env = {
    home: join(root, "home"),
    claudeDir: join(root, "home", ".claude"),
    dataDir: join(root, "home", ".lembra"),
    repoRoot: join(root, "repo"),
    cliEntry: join(root, "repo", "src", "cli", "index.ts"),
    bunPath: "/opt/bun/bin/bun",
    platform: "darwin",
    path: `/usr/bin:${join(root, "home", ".local", "bin")}`,
    uid: 501,
    hasClaude: true,
    exec: async (cmd) => {
      commands.push(cmd.join(" "));
      if (cmd.join(" ") === "claude plugin list --json") return { code: 0, out: pluginListed ? `[{"id":"${PLUGIN_ID}"}]` : "[]" };
      if (cmd.slice(0, 3).join(" ") === "claude plugin install") pluginListed = true;
      return { code: 0, out: "" };
    },
  };
  mkdirSync(env.claudeDir, { recursive: true });
  writeFileSync(join(env.claudeDir, "settings.json"), JSON.stringify({ model: "opus", hooks: { Stop: [] } }, null, 2));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const statuses = (results: { step: string; status: string }[]) => Object.fromEntries(results.map((r) => [r.step, r.status]));

describe("install", () => {
  test("links the command, raises retention, installs the plugin and the launchd agents", async () => {
    const results = await install(env, t);
    expect(statuses(results)).toEqual({
      link: "changed",
      retention: "changed",
      plugin: "changed",
      agents: "changed",
    });

    expect(readlinkSync(join(env.home, ".local", "bin", "lembra"))).toBe(env.cliEntry);

    const settings = JSON.parse(readFileSync(join(env.claudeDir, "settings.json"), "utf8"));
    expect(settings).toEqual({ model: "opus", hooks: { Stop: [] }, cleanupPeriodDays: 3650 });
    expect(existsSync(join(env.claudeDir, "settings.json.lembra-backup"))).toBe(true);

    const server = readFileSync(join(env.home, "Library", "LaunchAgents", `${AGENTS.server}.plist`), "utf8");
    expect(server).toContain(`<string>${env.cliEntry}</string>`);
    expect(server).toContain("<string>--serve</string>");

    expect(commands).toContain(`claude plugin marketplace add ${env.repoRoot}`);
    expect(commands).toContain(`claude plugin install ${PLUGIN_ID} --scope user`);
    expect(commands).toContain(`launchctl bootstrap gui/501 ${join(env.home, "Library", "LaunchAgents", `${AGENTS.index}.plist`)}`);
  });

  test("is idempotent", async () => {
    await install(env, t);
    commands = [];
    const again = await install(env, t);
    expect(again.every((result) => result.status === "ok")).toBe(true);
    expect(commands.filter((command) => !command.startsWith("launchctl print"))).toEqual(["claude plugin list --json"]);
  });

  test("--dry-run reports the plan without touching anything", async () => {
    const results = await install(env, t, { dryRun: true });
    expect(results.filter((r) => r.status === "changed")).toHaveLength(4);
    expect(existsSync(join(env.home, ".local", "bin", "lembra"))).toBe(false);
    expect(JSON.parse(readFileSync(join(env.claudeDir, "settings.json"), "utf8")).cleanupPeriodDays).toBeUndefined();
    expect(commands.filter((command) => !command.startsWith("launchctl print"))).toEqual(["claude plugin list --json"]);
  });

  test("leaves a foreign command of the same name alone and skips what the machine lacks", async () => {
    mkdirSync(join(env.home, ".local", "bin"), { recursive: true });
    symlinkSync("/somewhere/else", join(env.home, ".local", "bin", "lembra"));
    const results = statuses(await install({ ...env, platform: "linux", hasClaude: false }, t));
    expect(results).toMatchObject({
      link: "skipped",
      plugin: "skipped",
      agents: "skipped",
    });
  });
});

test("uninstall removes agents, plugin and link but keeps data and retention", async () => {
  await install(env, t);
  mkdirSync(env.dataDir, { recursive: true });
  commands = [];
  const results = statuses(await uninstall(env, t));
  expect(results).toEqual({ agents: "changed", plugin: "changed", link: "changed" });
  expect(existsSync(join(env.home, "Library", "LaunchAgents", `${AGENTS.server}.plist`))).toBe(false);
  expect(existsSync(join(env.home, ".local", "bin", "lembra"))).toBe(false);
  expect(existsSync(env.dataDir)).toBe(true);
  expect(commands).toContain(`claude plugin uninstall ${PLUGIN_ID}`);
  expect(JSON.parse(readFileSync(join(env.claudeDir, "settings.json"), "utf8")).cleanupPeriodDays).toBe(3650);
});

test("launchAgentPlist escapes XML and restarts the server only after a crash", () => {
  const plist = launchAgentPlist({ label: "x", args: ["/a&b", "<c>"], env: { PATH: "/usr/bin", LANG: "pt_BR.UTF-8" }, log: "/tmp/l.log", keepAlive: true });
  expect(plist).toContain("<string>/a&amp;b</string>");
  expect(plist).toContain("<string>&lt;c&gt;</string>");
  expect(plist).toContain("<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>");
  expect(plist).toContain("<key>RunAtLoad</key><true/>");
  expect(plist).toContain("<key>LANG</key><string>pt_BR.UTF-8</string>");
  const daily = launchAgentPlist({ label: "y", args: ["a"], env: { PATH: "/usr/bin", LANG: "pt_BR.UTF-8" }, log: "/tmp/l.log", calendar: { Hour: 12, Minute: 30 } });
  expect(daily).toContain("<key>Hour</key><integer>12</integer>");
  expect(daily).not.toContain("KeepAlive");
});

test("reloads an agent whose plist is current but launchd does not have loaded", async () => {
  await install(env, t);
  const exec = env.exec;
  env.exec = async (cmd) => (cmd.join(" ").startsWith(`launchctl print gui/501/${AGENTS.server}`) ? { code: 113, out: "not found" } : exec(cmd));
  commands = [];
  expect(statuses(await install(env, t)).agents).toBe("changed");
  expect(commands).toContain(`launchctl bootstrap gui/501 ${join(env.home, "Library", "LaunchAgents", `${AGENTS.server}.plist`)}`);
  expect(commands.some((command) => command.includes(`bootstrap gui/501 ${join(env.home, "Library", "LaunchAgents", `${AGENTS.index}.plist`)}`))).toBe(false);
});
