import { INTL_TAG, type Locale } from "../../../i18n/locale";
import { UI } from "../../../i18n/ui";
import { locale as currentLocale } from "./i18n";

// Display formatting for the page, in the page's language. `now` and `locale` are injectable for tests.

const DAY_MS = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: Locale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}:${JSON.stringify(options)}`;
  let format = formatters.get(key);
  if (!format) formatters.set(key, (format = new Intl.DateTimeFormat(INTL_TAG[locale], options)));
  return format;
}

const clean = (text: string) => text.replaceAll(".", "").toUpperCase();

// "19 OCT" / "19 OUT" (or with the year), built from parts so "de" and dots never sneak in.
function stamp(date: Date, withYear: boolean, locale: Locale): string {
  const parts = Object.fromEntries(
    formatter(locale, { day: "2-digit", month: "short", year: "numeric" })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return clean([parts.day, parts.month, withYear ? parts.year : ""].join(" ").trim());
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function dayKey(iso: string | null): string {
  if (!iso) return "none";
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

// Day stamp for list dividers: TODAY, YESTERDAY, WED · 15 OCT, 03 MAR 2025.
export function dayStamp(iso: string | null, now = new Date(), locale: Locale = currentLocale): string {
  const words = UI[locale].time;
  if (!iso) return words.noDate;
  const date = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (days === 0) return words.today;
  if (days === 1) return words.yesterday;
  if (days < 7) return `${clean(formatter(locale, { weekday: "short" }).format(date))} · ${stamp(date, false, locale)}`;
  return stamp(date, date.getFullYear() !== now.getFullYear(), locale);
}

export function clock(iso: string | null, locale: Locale = currentLocale): string {
  return iso ? formatter(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "—";
}

export function fullDate(iso: string | null, locale: Locale = currentLocale): string {
  return iso ? formatter(locale, { dateStyle: "long", timeStyle: "short" }).format(new Date(iso)) : "—";
}

export function monthYear(iso: string | null, locale: Locale = currentLocale): string {
  return iso ? formatter(locale, { month: "short", year: "numeric" }).format(new Date(iso)) : "—";
}

export function ago(iso: string | null, now = new Date(), locale: Locale = currentLocale): string {
  const words = UI[locale].time;
  if (!iso) return words.never;
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return words.ago(seconds, "s");
  if (seconds < 3600) return words.ago(Math.round(seconds / 60), "min");
  if (seconds < 86_400) return words.ago(Math.round(seconds / 3600), "h");
  return words.ago(Math.round(seconds / 86_400), "d");
}

export function bytes(n: number | null, locale: Locale = currentLocale): string {
  if (n === null) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString(INTL_TAG[locale], { maximumFractionDigits: 1 })} ${units[unit]}`;
}

// Stable hue per repository, so the same repo always gets the same tab color.
export function repoHue(name: string): number {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}
