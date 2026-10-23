// Display formatting for the page (pt-BR). Pure functions; `now` is injectable for tests.

const DAY_MS = 86_400_000;
const time = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });
const dayMonthYear = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
const full = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeStyle: "short" });

const clean = (text: string) => text.replaceAll(".", "").toUpperCase();

// "19 OUT" or "19 OUT 2025", built from parts because pt-BR formats it as "19 de out.".
function stamp(date: Date, withYear: boolean): string {
  const parts = Object.fromEntries(dayMonthYear.formatToParts(date).map((part) => [part.type, part.value]));
  return clean([parts.day, parts.month, withYear ? parts.year : ""].join(" ").trim());
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function dayKey(iso: string | null): string {
  if (!iso) return "sem data";
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

// Day stamp for list dividers: HOJE, ONTEM, QUA · 15 OUT, 03 MAR 2025.
export function dayStamp(iso: string | null, now = new Date()): string {
  if (!iso) return "SEM DATA";
  const date = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (days === 0) return "HOJE";
  if (days === 1) return "ONTEM";
  if (days < 7) return `${clean(weekday.format(date))} · ${stamp(date, false)}`;
  return stamp(date, date.getFullYear() !== now.getFullYear());
}

export function clock(iso: string | null): string {
  return iso ? time.format(new Date(iso)) : "—";
}

export function fullDate(iso: string | null): string {
  return iso ? full.format(new Date(iso)) : "—";
}

export function ago(iso: string | null, now = new Date()): string {
  if (!iso) return "nunca";
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `há ${seconds} s`;
  if (seconds < 3600) return `há ${Math.round(seconds / 60)} min`;
  if (seconds < 86_400) return `há ${Math.round(seconds / 3600)} h`;
  return `há ${Math.round(seconds / 86_400)} d`;
}

export function bytes(n: number | null): string {
  if (n === null) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ${units[unit]}`;
}

export function count(n: number, one: string, many: string): string {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? one : many}`;
}

// Stable hue per repository, so the same repo always gets the same tab color.
export function repoHue(name: string): number {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}
