import { readConfig } from "../core/config";
import { matchLocale, resolveLocale, type Locale } from "./locale";

export type LocaleSource = "flag" | "env" | "config" | "system";

// Language for processes without a browser: --lang, LEMBRA_LANG, `lembra lang`, then the system locale.
export function localeChoice(opts: { flag?: string; dataDir: string; env?: Record<string, string | undefined> }): { locale: Locale; source: LocaleSource } {
  const env = opts.env ?? process.env;
  const chosen: [LocaleSource, string | undefined][] = [
    ["flag", opts.flag],
    ["env", env.LEMBRA_LANG],
    ["config", readConfig(opts.dataDir).lang],
  ];
  for (const [source, value] of chosen) {
    const locale = matchLocale(value);
    if (locale) return { locale, source };
  }
  return { locale: resolveLocale(env.LC_ALL, env.LC_MESSAGES, env.LANG), source: "system" };
}

export const preferredLocale = (opts: Parameters<typeof localeChoice>[0]): Locale => localeChoice(opts).locale;
