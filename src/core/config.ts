import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Locale } from "../i18n/locale";

// Small persisted preferences, shared by the CLI, the MCP server, hooks and the launchd agents.
export interface Config {
  lang?: Locale;
}

const file = (dataDir: string) => join(dataDir, "config.json");

export function readConfig(dataDir: string): Config {
  try {
    return existsSync(file(dataDir)) ? JSON.parse(readFileSync(file(dataDir), "utf8")) : {};
  } catch {
    return {};
  }
}

export function writeConfig(dataDir: string, config: Config) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(file(dataDir), `${JSON.stringify(config, null, 2)}\n`);
}
