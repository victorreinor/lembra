import type { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename } from "node:path";

export const WORKTREE_SUFFIX = /\/\.(?:claude\/)?worktrees\/[^/]+.*$/;

export function repoFromRemote(url: string): string | undefined {
  return url.trim().match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/)?.[1];
}

function git(dir: string, ...args: string[]): string | undefined {
  const result = Bun.spawnSync(["git", "-C", dir, ...args], { stderr: "ignore" });
  return result.exitCode === 0 ? result.stdout.toString().trim() : undefined;
}

function detectRepo(cwd: string): string {
  const dir = cwd.replace(WORKTREE_SUFFIX, "");
  if (dir === homedir()) return "~";
  if (existsSync(dir)) {
    const remote = git(dir, "remote", "get-url", "origin");
    const fromRemote = remote && repoFromRemote(remote);
    if (fromRemote) return fromRemote;
    const top = git(dir, "rev-parse", "--show-toplevel");
    if (top) return basename(top);
  }
  return basename(dir) || dir;
}

export function resolveRepo(db: Database, cwd: string): string {
  const cached = db.query<{ repo: string }, [string]>("SELECT repo FROM repos WHERE cwd = ?").get(cwd);
  if (cached) return cached.repo;
  const repo = detectRepo(cwd);
  db.query("INSERT OR REPLACE INTO repos (cwd, repo) VALUES (?, ?)").run(cwd, repo);
  return repo;
}
