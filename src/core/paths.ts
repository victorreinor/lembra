import { homedir } from "node:os";
import { join } from "node:path";

export interface Paths {
  claudeDir: string;
  dataDir: string;
}

export function defaultPaths(env = process.env): Paths {
  return {
    claudeDir: env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"),
    dataDir: env.LEMBRA_HOME ?? join(homedir(), ".lembra"),
  };
}

export function expandHome(path: string): string {
  return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path;
}
