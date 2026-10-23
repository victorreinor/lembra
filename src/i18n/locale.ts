// Supported languages. English is the reference catalog; every other locale must match its shape.
export const LOCALES = ["en", "pt-BR"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

// Tag used by Intl for dates and numbers.
export const INTL_TAG: Record<Locale, string> = { en: "en-US", "pt-BR": "pt-BR" };

// Accepts BCP 47 tags and POSIX locales: "pt-BR", "pt_BR.UTF-8", "pt", "en-NZ", "C" (no match).
export function matchLocale(value: string | null | undefined): Locale | null {
  const tag = value?.split(".")[0]?.replace("_", "-").toLowerCase();
  if (!tag) return null;
  if (tag === "pt" || tag.startsWith("pt-")) return "pt-BR";
  if (tag === "en" || tag.startsWith("en-")) return "en";
  return null;
}

// First candidate that names a supported language wins.
export function resolveLocale(...candidates: (string | null | undefined)[]): Locale {
  for (const candidate of candidates) {
    const locale = matchLocale(candidate);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}
