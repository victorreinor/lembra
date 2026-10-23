import { homedir } from "node:os";
import { formatBytes, formatNumber } from "../i18n/format";
import { INTL_TAG, type Locale } from "../i18n/locale";

// Plain-text helpers shared by every interface (CLI, MCP, handoff). No color here.

export function oneLine(text: string | null | undefined, max: number): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
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

// Dates, sizes and counts in the conventions of one language.
export interface TextFormat {
  locale: Locale;
  when(iso: string | null | undefined): string;
  bytes(n: number): string;
  count(n: number): string;
}

const formats = new Map<Locale, TextFormat>();

export function textFormat(locale: Locale): TextFormat {
  const cached = formats.get(locale);
  if (cached) return cached;
  const dateTime = new Intl.DateTimeFormat(INTL_TAG[locale], { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  const format: TextFormat = {
    locale,
    when: (iso) => (iso ? dateTime.format(new Date(iso)).replace(", ", " ") : "—"),
    bytes: (n) => formatBytes(n, locale),
    count: (n) => formatNumber(n, locale),
  };
  formats.set(locale, format);
  return format;
}
