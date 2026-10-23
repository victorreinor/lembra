import type { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { WORKTREE_SUFFIX } from "./repo";
import type { Session } from "./sessions";

export interface BranchFacts {
  exists: boolean;
  upstream: boolean;
  ahead: number;
  // Uncommitted changes while this branch is checked out.
  dirty: boolean;
  pr: "OPEN" | "MERGED" | "CLOSED" | "NONE" | "UNKNOWN";
}

// Everything pending.ts needs from git and gh, so tests can swap in fixed answers.
export interface GitProbe {
  root(cwd: string): Promise<string | null>;
  defaultBranch(root: string): Promise<string | null>;
  facts(root: string, branch: string): Promise<BranchFacts>;
}

export type PendingReason = "no-push" | "ahead" | "dirty" | "no-pr" | "pr-closed";

export interface PendingItem {
  repo: string | null;
  root: string;
  branch: string;
  reasons: PendingReason[];
  facts: BranchFacts;
  lastSession: Session;
  sessions: number;
}

export const REASON_LABELS: Record<PendingReason, string> = {
  "no-push": "branch nunca enviada",
  ahead: "commits sem push",
  dirty: "alterações não commitadas",
  "no-pr": "sem PR",
  "pr-closed": "PR fechado sem merge",
};

const MAINLINE = new Set(["main", "master", "develop", "HEAD"]);

export function describeReasons(item: Pick<PendingItem, "reasons" | "facts">): string[] {
  return item.reasons.map((reason) => (reason === "ahead" ? `${item.facts.ahead} ${REASON_LABELS.ahead}` : REASON_LABELS[reason]));
}

// A branch is pending until its work is merged; an open PR counts as delivered.
export function pendingReasons(facts: BranchFacts): PendingReason[] {
  if (!facts.exists || facts.pr === "MERGED") return [];
  const reasons: PendingReason[] = [];
  if (!facts.upstream) reasons.push("no-push");
  else if (facts.ahead > 0) reasons.push("ahead");
  if (facts.dirty) reasons.push("dirty");
  if (facts.pr === "NONE") reasons.push("no-pr");
  if (facts.pr === "CLOSED") reasons.push("pr-closed");
  return reasons;
}

export async function findPending(db: Database, opts: { since: string; probe: GitProbe; concurrency?: number }): Promise<PendingItem[]> {
  const sessions = db
    .query<Session, any>(
      `SELECT * FROM sessions
       WHERE source = 'transcript' AND branch IS NOT NULL AND cwd IS NOT NULL AND ended_at >= $since
       ORDER BY ended_at DESC`,
    )
    .all({ since: opts.since });

  const rootOf = new Map<string, string | null>();
  const groups = new Map<string, { root: string; branch: string; sessions: Session[] }>();
  for (const session of sessions) {
    if (MAINLINE.has(session.branch!)) continue;
    if (!rootOf.has(session.cwd!)) rootOf.set(session.cwd!, await opts.probe.root(session.cwd!));
    const root = rootOf.get(session.cwd!);
    if (!root) continue;
    const key = `${root}\0${session.branch}`;
    const group = groups.get(key) ?? { root, branch: session.branch!, sessions: [] };
    group.sessions.push(session);
    groups.set(key, group);
  }

  const defaults = new Map<string, string | null>();
  for (const { root } of groups.values()) {
    if (!defaults.has(root)) defaults.set(root, await opts.probe.defaultBranch(root));
  }

  const items: PendingItem[] = [];
  await forEachLimited([...groups.values()], opts.concurrency ?? 6, async (group) => {
    if (group.branch === defaults.get(group.root)) return;
    const facts = await opts.probe.facts(group.root, group.branch);
    const reasons = pendingReasons(facts);
    if (!reasons.length) return;
    const lastSession = group.sessions[0]!;
    items.push({ repo: lastSession.repo, root: group.root, branch: group.branch, reasons, facts, lastSession, sessions: group.sessions.length });
  });
  return items.sort((a, b) => (b.lastSession.ended_at ?? "").localeCompare(a.lastSession.ended_at ?? ""));
}

async function forEachLimited<T>(items: T[], limit: number, task: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await task(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

async function run(cmd: string[], cwd?: string): Promise<string | null> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "ignore" });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return code === 0 ? out.trim() : null;
}

// The real probe: git for branch state, gh (when installed and logged in) for pull requests.
export const systemGit: GitProbe = {
  async root(cwd) {
    const dir = cwd.replace(WORKTREE_SUFFIX, "");
    return existsSync(dir) ? run(["git", "-C", dir, "rev-parse", "--show-toplevel"]) : null;
  },
  async defaultBranch(root) {
    const ref = await run(["git", "-C", root, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
    return ref ? ref.replace(/^origin\//, "") : null;
  },
  async facts(root, branch) {
    const exists = (await run(["git", "-C", root, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])) !== null;
    if (!exists) return { exists, upstream: false, ahead: 0, dirty: false, pr: "UNKNOWN" };
    const upstream = await run(["git", "-C", root, "rev-parse", "--abbrev-ref", `${branch}@{upstream}`]);
    const ahead = upstream ? Number((await run(["git", "-C", root, "rev-list", "--count", `${upstream}..${branch}`])) ?? 0) : 0;
    const current = await run(["git", "-C", root, "branch", "--show-current"]);
    const dirty = current === branch && Boolean(await run(["git", "-C", root, "status", "--porcelain"]));
    return { exists, upstream: Boolean(upstream), ahead, dirty, pr: await pullRequestState(root, branch) };
  },
};

async function pullRequestState(root: string, branch: string): Promise<BranchFacts["pr"]> {
  if (!Bun.which("gh")) return "UNKNOWN";
  const out = await run(["gh", "pr", "list", "--head", branch, "--state", "all", "--limit", "1", "--json", "state"], root);
  if (out === null) return "UNKNOWN";
  const state = (JSON.parse(out) as { state: string }[])[0]?.state;
  return state === "OPEN" || state === "MERGED" || state === "CLOSED" ? state : "NONE";
}
