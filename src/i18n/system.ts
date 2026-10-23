import { readConfig } from "../core/config";
import { resolveLocale, type Locale } from "./locale";

// Language for processes without a browser: --lang, LEMBRA_LANG, `lembra lang`, then the system locale.
export function preferredLocale(opts: { flag?: string; dataDir: string; env?: Record<string, string | undefined> }): Locale {
  const env = opts.env ?? process.env;
  return resolveLocale(opts.flag, env.LEMBRA_LANG, readConfig(opts.dataDir).lang, env.LC_ALL, env.LC_MESSAGES, env.LANG);
}
