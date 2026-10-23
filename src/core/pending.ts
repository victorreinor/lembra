import type { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { CORE } from "../i18n/core";
import type { Locale } from "../i18n/locale";
import { exec, forEachLimited } from "./exec";
import { parseDate } from "./query";
import { WORKTREE_SUFFIX } from "./repo";
import type { Session } from "./sessions";

export type PullRequestState = "OPEN" | "MERGED" | "CLOSED" | "NONE" | "UNKNOWN";

export interface BranchFacts {
  exists: boolean;
  upstream: boolean;
  ahead: number;
  // Uncommitted changes while this branch is checked out.
  dirty: boolean;
  pr: PullRequestState;
}

// Everything pending.ts needs from git and gh, so tests can swap in fixed answers.
export interface GitProbe {
  root(cwd: string): Promise<string | null>;
  defaultBranch(root: string): Promise<string | null>;
  facts(root: string, branch: string): Promise<Omit<BranchFacts, "pr">>;
  // PR state for each branch that gh can see; branches left out are UNKNOWN.
  pullRequests(root: string, branches: string[]): Promise<Map<string, PullRequestState>>;
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

const MAINLINE = new Set(["main", "master", "develop", "HEAD"]);

export function describeReasons(item: Pick<PendingItem, "reasons" | "facts">, locale: Locale): string[] {
  const labels = CORE[locale].pending;
  return item.reasons.map((reason) => (reason === "ahead" ? labels.ahead(item.facts.ahead) : labels[reason]()));
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

// Default period for every interface (CLI, MCP, page).
export const DEFAULT_PENDING_SINCE = "14d";
const CONCURRENCY = 6;

export async function findPending(db: Database, opts: { since?: string; probe: GitProbe }): Promise<PendingItem[]> {
  const sessions = db
    .query<Session, any>(
      `SELECT * FROM sessions
       WHERE source = 'transcript' AND branch IS NOT NULL AND cwd IS NOT NULL AND ended_at >= $since
       ORDER BY ended_at DESC`,
    )
    .all({ since: parseDate(opts.since || DEFAULT_PENDING_SINCE) })
    .filter((session) => !MAINLINE.has(session.branch!));

  const rootOf = new Map<string, string | null>();
  await forEachLimited([...new Set(sessions.map((session) => session.cwd!))], CONCURRENCY, async (cwd) => {
    rootOf.set(cwd, await opts.probe.root(cwd));
  });

  const groups = new Map<string, { root: string; branch: string; sessions: Session[] }>();
  for (const session of sessions) {
    const root = rootOf.get(session.cwd!);
    if (!root) continue;
    const key = `${root}\0${session.branch}`;
    const group = groups.get(key) ?? { root, branch: session.branch!, sessions: [] };
    group.sessions.push(session);
    groups.set(key, group);
  }

  const repos = new Map<string, { defaultBranch: string | null; pullRequests: Map<string, PullRequestState> }>();
  const branchesOf = Map.groupBy(groups.values(), (group) => group.root);
  await forEachLimited([...branchesOf.keys()], CONCURRENCY, async (root) => {
    const branches = branchesOf.get(root)!.map((group) => group.branch);
    const [defaultBranch, pullRequests] = await Promise.all([opts.probe.defaultBranch(root), opts.probe.pullRequests(root, branches)]);
    repos.set(root, { defaultBranch, pullRequests });
  });

  const items: PendingItem[] = [];
  await forEachLimited([...groups.values()], CONCURRENCY, async (group) => {
    const repo = repos.get(group.root)!;
    if (group.branch === repo.defaultBranch) return;
    const facts: BranchFacts = { ...(await opts.probe.facts(group.root, group.branch)), pr: repo.pullRequests.get(group.branch) ?? "UNKNOWN" };
    const reasons = pendingReasons(facts);
    if (!reasons.length) return;
    const lastSession = group.sessions[0]!;
    items.push({ repo: lastSession.repo, root: group.root, branch: group.branch, reasons, facts, lastSession, sessions: group.sessions.length });
  });
  return items.sort((a, b) => (b.lastSession.ended_at ?? "").localeCompare(a.lastSession.ended_at ?? ""));
}

async function git(root: string, ...args: string[]): Promise<string | null> {
  const { code, out } = await exec(["git", "-C", root, ...args]);
  return code === 0 ? out : null;
}

// The real probe: git for branch state, gh (when installed and logged in) for pull requests.
export const systemGit: GitProbe = {
  async root(cwd) {
    const dir = cwd.replace(WORKTREE_SUFFIX, "");
    return existsSync(dir) ? git(dir, "rev-parse", "--show-toplevel") : null;
  },
  async defaultBranch(root) {
    const ref = await git(root, "symbolic-ref", "--short", "refs/remotes/origin/HEAD");
    return ref ? ref.replace(/^origin\//, "") : null;
  },
  async facts(root, branch) {
    const exists = (await git(root, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`)) !== null;
    if (!exists) return { exists, upstream: false, ahead: 0, dirty: false };
    const upstream = await git(root, "rev-parse", "--abbrev-ref", `${branch}@{upstream}`);
    const ahead = upstream ? Number((await git(root, "rev-list", "--count", `${upstream}..${branch}`)) ?? 0) : 0;
    const current = await git(root, "branch", "--show-current");
    const dirty = current === branch && Boolean(await git(root, "status", "--porcelain"));
    return { exists, upstream: Boolean(upstream), ahead, dirty };
  },
  pullRequests,
};

const PR_LIST_LIMIT = 200;
const hasGh = Boolean(Bun.which("gh"));

// One `gh pr list` per repository; only branches older than its newest PRs get a query of their own.
async function pullRequests(root: string, branches: string[]): Promise<Map<string, PullRequestState>> {
  const states = new Map<string, PullRequestState>();
  if (!hasGh) return states;
  const list = async (...args: string[]) => {
    const { code, out } = await exec(["gh", "pr", "list", "--state", "all", "--json", "headRefName,state", ...args], { cwd: root });
    return code === 0 ? (JSON.parse(out) as { headRefName: string; state: string }[]) : null;
  };
  const recent = await list("--limit", String(PR_LIST_LIMIT));
  if (!recent) return states;
  // Newest first: the first PR seen for a branch is its latest.
  for (const pr of recent) if (!states.has(pr.headRefName)) states.set(pr.headRefName, prState(pr.state));
  const complete = recent.length < PR_LIST_LIMIT;
  await forEachLimited(
    branches.filter((branch) => !states.has(branch)),
    CONCURRENCY,
    async (branch) => {
      if (complete) return void states.set(branch, "NONE");
      const own = await list("--head", branch, "--limit", "1");
      if (own) states.set(branch, own[0] ? prState(own[0].state) : "NONE");
    },
  );
  return states;
}

const prState = (state: string): PullRequestState => (state === "OPEN" || state === "MERGED" || state === "CLOSED" ? state : "NONE");
