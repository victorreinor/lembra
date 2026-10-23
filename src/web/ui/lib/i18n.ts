import { LOCALES, resolveLocale, type Locale } from "../../../i18n/locale";
import { UI, type UiCatalog } from "../../../i18n/ui";
import { Kbd } from "../components/kbd/kbd";
import type { Child } from "./dom";

// The page's language: the visitor's choice, else the language set with `lembra lang`, else the browser's.
// `t` is a live binding: components read it when they render, after initLocale() ran.

const KEY = "lembra:lang";

export let locale: Locale = resolveLocale(...(globalThis.navigator?.languages ?? []));
export let t: UiCatalog = UI[locale];

function stored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setLocale(next: Locale) {
  locale = next;
  t = UI[next];
  document.documentElement.lang = next;
}

export function initLocale(serverDefault?: string | null) {
  setLocale(resolveLocale(stored(), serverDefault, ...(navigator.languages ?? [])));
}

// Cycles through the languages and reloads, so every component renders again in the new one.
export function switchLocale() {
  const next = LOCALES[(LOCALES.indexOf(locale) + 1) % LOCALES.length]!;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Without storage the choice lasts until the reload below.
  }
  setLocale(next);
  location.reload();
}

// "Press [o] to resume" → text with <kbd>o</kbd>.
export function withKeys(template: string): Child[] {
  return template.split(/(\[[^\]]+\])/).map((part) => (part.startsWith("[") && part.endsWith("]") ? Kbd(part.slice(1, -1)) : part));
}
