import { LembraError } from "./errors";

export interface Filters {
  repo?: string;
  branch?: string;
  since?: string;
  until?: string;
}

export interface FilterColumns {
  repo: string;
  branch: string;
  from: string;
  to: string;
}

// Filters as every interface receives them (text, dates like "7d" or "01/10"); empty values mean no filter.
export function parseFilters(raw: { repo?: string | null; branch?: string | null; since?: string | null; until?: string | null }): Filters {
  return {
    repo: raw.repo || undefined,
    branch: raw.branch || undefined,
    since: raw.since ? parseDate(raw.since) : undefined,
    until: raw.until ? parseDate(raw.until, true) : undefined,
  };
}

export function filterSql(filters: Filters, cols: FilterColumns): { where: string[]; params: Record<string, string> } {
  const where: string[] = [];
  const params: Record<string, string> = {};
  if (filters.repo) {
    where.push(`${cols.repo} LIKE $repo`);
    params.repo = `%${filters.repo}%`;
  }
  if (filters.branch) {
    where.push(`${cols.branch} LIKE $branch`);
    params.branch = `%${filters.branch}%`;
  }
  if (filters.since) {
    where.push(`${cols.to} >= $since`);
    params.since = filters.since;
  }
  if (filters.until) {
    where.push(`${cols.from} < $until`);
    params.until = filters.until;
  }
  return { where, params };
}

// Unquoted words match as prefixes ("fatur" finds "faturamento"); quoted text is an exact phrase.
export function toMatchQuery(input: string): string {
  return (input.match(/"[^"]*"|\S+/g) ?? [])
    .map((term) => {
      const phrase = term.length > 1 && term.startsWith('"') && term.endsWith('"');
      const text = (phrase ? term.slice(1, -1) : term.replace(/\*+$/, "")).replaceAll('"', '""').trim();
      if (!text) return undefined;
      return phrase ? `"${text}"` : `"${text}"*`;
    })
    .filter(Boolean)
    .join(" ");
}

// Accepts 2026-10-01, 01/10, 01/10/2026 or relative spans like 7d, 2w, 3m, 1y.
export function parseDate(input: string, endOfDay = false, now = new Date()): string {
  const relative = input.match(/^(\d+)([dwmy])$/);
  if (relative) {
    const n = Number(relative[1]);
    const date = new Date(now);
    if (relative[2] === "d") date.setDate(date.getDate() - n);
    if (relative[2] === "w") date.setDate(date.getDate() - 7 * n);
    if (relative[2] === "m") date.setMonth(date.getMonth() - n);
    if (relative[2] === "y") date.setFullYear(date.getFullYear() - n);
    return date.toISOString();
  }
  const br = input.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/);
  const iso = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  let date: Date | undefined;
  if (br) {
    const year = br[3] ? Number(br[3].length === 2 ? `20${br[3]}` : br[3]) : now.getFullYear();
    date = new Date(year, Number(br[2]) - 1, Number(br[1]));
  } else if (iso) {
    date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }
  if (!date || Number.isNaN(date.getTime())) throw new LembraError("invalidDate", { input });
  if (endOfDay) date.setDate(date.getDate() + 1);
  return date.toISOString();
}
