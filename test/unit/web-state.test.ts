import { describe, expect, test } from "bun:test";
import { ago, bytes, dayStamp, repoHue } from "../../src/web/ui/lib/format";
import { DEFAULT_STATE, fromSearch, hasActiveFilters, toSearch } from "../../src/web/ui/lib/state";

describe("URL state", () => {
  test("round-trips through the query string and omits defaults", () => {
    const state = { ...DEFAULT_STATE, view: "files" as const, q: "fix sql", repo: "acme/api", missing: true, session: "abc" };
    expect(toSearch(state)).toBe("?view=files&q=fix+sql&repo=acme%2Fapi&missing=1&s=abc");
    expect(fromSearch(toSearch(state))).toEqual(state);
    expect(toSearch(DEFAULT_STATE)).toBe("");
  });

  test("falls back to the sessions view for unknown values", () => {
    expect(fromSearch("?view=nope").view).toBe("sessions");
  });

  test("only counts the filters the current view offers", () => {
    expect(hasActiveFilters({ ...DEFAULT_STATE, missing: true })).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_STATE, view: "files", missing: true })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_STATE, view: "pending", repo: "x" })).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_STATE, view: "pending", since: "30d" })).toBe(true);
  });
});

describe("display formatting", () => {
  const now = new Date(2026, 9, 22, 18, 0);
  const iso = (...args: [number, number, number, number?]) => new Date(...args).toISOString();

  test("day stamps read like an archive diary, in each language", () => {
    expect(dayStamp(iso(2026, 9, 22, 9), now, "pt-BR")).toBe("HOJE");
    expect(dayStamp(iso(2026, 9, 21, 23), now, "en")).toBe("YESTERDAY");
    expect(dayStamp(iso(2026, 9, 19, 12), now, "pt-BR")).toMatch(/^[A-ZÁÉ]{3} · 19 OUT$/);
    expect(dayStamp(iso(2026, 9, 19, 12), now, "en")).toBe("MON · 19 OCT");
    expect(dayStamp(iso(2026, 2, 3), now, "pt-BR")).toBe("03 MAR");
    expect(dayStamp(iso(2025, 2, 3), now, "pt-BR")).toBe("03 MAR 2025");
    expect(dayStamp(null, now, "en")).toBe("NO DATE");
  });

  test("relative times and sizes", () => {
    expect(ago(new Date(now.getTime() - 42_000).toISOString(), now, "pt-BR")).toBe("há 42 s");
    expect(ago(new Date(now.getTime() - 3 * 3_600_000).toISOString(), now, "en")).toBe("3 h ago");
    expect(bytes(1536, "pt-BR")).toBe("1,5 KB");
    expect(bytes(1536, "en")).toBe("1.5 KB");
  });

  test("each repo keeps the same hue", () => {
    expect(repoHue("billing-api")).toBe(repoHue("billing-api"));
    expect(repoHue("billing-api")).not.toBe(repoHue("orders"));
    expect(repoHue("x")).toBeGreaterThanOrEqual(0);
    expect(repoHue("x")).toBeLessThan(360);
  });
});
