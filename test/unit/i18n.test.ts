import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeConfig } from "../../src/core/config";
import { LembraError } from "../../src/core/errors";
import { CLI } from "../../src/i18n/cli";
import { CORE } from "../../src/i18n/core";
import { ERRORS } from "../../src/i18n/errors";
import { LOCALES, matchLocale, resolveLocale } from "../../src/i18n/locale";
import { MCP } from "../../src/i18n/mcp";
import { preferredLocale } from "../../src/i18n/system";
import { UI } from "../../src/i18n/ui";

describe("locale resolution", () => {
  test("understands BCP 47 tags and POSIX locales", () => {
    expect(matchLocale("pt_BR.UTF-8")).toBe("pt-BR");
    expect(matchLocale("pt-PT")).toBe("pt-BR");
    expect(matchLocale("en_NZ.UTF-8")).toBe("en");
    expect(matchLocale("C")).toBeNull();
    expect(matchLocale(undefined)).toBeNull();
  });

  test("takes the first supported candidate and falls back to English", () => {
    expect(resolveLocale("es-ES", "C", "pt-BR", "en")).toBe("pt-BR");
    expect(resolveLocale("es", null)).toBe("en");
  });

  test("prefers --lang, then LEMBRA_LANG, then `lembra lang`, then the system", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "lembra-i18n-"));
    try {
      expect(preferredLocale({ dataDir, env: { LANG: "pt_BR.UTF-8" } })).toBe("pt-BR");
      writeConfig(dataDir, { lang: "en" });
      expect(preferredLocale({ dataDir, env: { LANG: "pt_BR.UTF-8" } })).toBe("en");
      expect(preferredLocale({ dataDir, env: { LEMBRA_LANG: "pt-BR" } })).toBe("pt-BR");
      expect(preferredLocale({ dataDir, flag: "en", env: { LEMBRA_LANG: "pt-BR" } })).toBe("en");
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

// TypeScript already forces every catalog to match English; this also catches values smuggled in with casts.
function shape(value: unknown): unknown {
  if (typeof value === "function") return `fn/${value.length}`;
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, shape(inner)]).sort());
  return typeof value;
}

test.each([
  ["errors", ERRORS],
  ["core", CORE],
  ["cli", CLI],
  ["mcp", MCP],
  ["ui", UI],
])("the %s catalog has the same keys in every language", (_name, catalog) => {
  for (const locale of LOCALES) expect(shape(catalog[locale as keyof typeof catalog])).toEqual(shape(catalog.en));
});

test("errors carry a code and render in any language", () => {
  const error = new LembraError("sessionNotFound", { ref: "3f2a" });
  expect(error.code).toBe("sessionNotFound");
  expect(error.message).toBe('No session with id or name "3f2a".');
  expect(error.in("pt-BR")).toBe('Nenhuma sessão com id ou nome "3f2a".');
});
