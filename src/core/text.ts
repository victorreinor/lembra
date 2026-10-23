import { homedir } from "node:os";

// Plain-text helpers shared by every interface (CLI, MCP, handoff). No color here.

export function oneLine(text: string | null | undefined, max: number): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const dateTime = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function when(iso: string | null | undefined): string {
  return iso ? dateTime.format(new Date(iso)).replace(", ", " ") : "—";
}

export function bytes(n: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ${units[i]}`;
}

export function count(n: number): string {
  return n.toLocaleString("pt-BR");
}

export function repoName(repo: string | null | undefined): string {
  return repo?.split("/").pop() ?? "?";
}

export function shortPath(path: string): string {
  const home = homedir();
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

// Search snippets mark matches as \x01…\x02; plain-text consumers get [brackets].
export function bracketMatches(snippet: string): string {
  return snippet.replaceAll("\x01", "[").replaceAll("\x02", "]");
}
