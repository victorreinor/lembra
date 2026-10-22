import { homedir } from "node:os";

const color = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code: string) => (text: string) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);

export const bold = paint("1");
export const dim = paint("2");
export const red = paint("31");
export const green = paint("32");
export const yellow = paint("33");
export const cyan = paint("36");

// search() marks matches with \x01…\x02 so rendering stays a CLI decision.
export function highlight(snippet: string): string {
  const marked = snippet.replaceAll("\x01", color ? "\x1b[1;33m" : "[").replaceAll("\x02", color ? "\x1b[0m" : "]");
  return color ? `${marked}\x1b[0m` : marked;
}

export function oneLine(text: string | null | undefined, max: number): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
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
