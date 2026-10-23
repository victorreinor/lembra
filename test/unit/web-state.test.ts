import { describe, expect, test } from "bun:test";
import { ago, bytes, count, dayStamp, repoHue } from "../../src/web/ui/lib/format";
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

  test("day stamps read like an archive diary", () => {
    expect(dayStamp(new Date(2026, 9, 22, 9).toISOString(), now)).toBe("HOJE");
    expect(dayStamp(new Date(2026, 9, 21, 23).toISOString(), now)).toBe("ONTEM");
    expect(dayStamp(new Date(2026, 9, 19, 12).toISOString(), now)).toMatch(/^[A-ZÁÉ]{3} · 19 OUT$/);
    expect(dayStamp(new Date(2026, 2, 3).toISOString(), now)).toBe("03 MAR");
    expect(dayStamp(new Date(2025, 2, 3).toISOString(), now)).toBe("03 MAR 2025");
    expect(dayStamp(null, now)).toBe("SEM DATA");
  });

  test("relative times, sizes and counts", () => {
    expect(ago(new Date(now.getTime() - 42_000).toISOString(), now)).toBe("há 42 s");
    expect(ago(new Date(now.getTime() - 3 * 3_600_000).toISOString(), now)).toBe("há 3 h");
    expect(bytes(1536)).toBe("1,5 KB");
    expect(count(1, "sessão", "sessões")).toBe("1 sessão");
    expect(count(1291, "sessão", "sessões")).toBe("1.291 sessões");
  });

  test("each repo keeps the same hue", () => {
    expect(repoHue("billing-api")).toBe(repoHue("billing-api"));
    expect(repoHue("billing-api")).not.toBe(repoHue("orders"));
    expect(repoHue("x")).toBeGreaterThanOrEqual(0);
    expect(repoHue("x")).toBeLessThan(360);
  });
});
