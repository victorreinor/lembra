import { describe, expect, test } from "bun:test";
import { LembraError } from "../../src/core/errors";
import { filterSql, parseDate, toMatchQuery } from "../../src/core/query";

describe("toMatchQuery", () => {
  test("matches each word as a prefix", () => {
    expect(toMatchQuery("fatur sql")).toBe('"fatur"* "sql"*');
  });

  test("keeps quoted text as an exact phrase", () => {
    expect(toMatchQuery('"relatório mensal" worker')).toBe('"relatório mensal" "worker"*');
  });

  test("neutralizes FTS syntax", () => {
    expect(toMatchQuery('fix-billing.sql a"b NOT*')).toBe('"fix-billing.sql"* "a""b"* "NOT"*');
    expect(toMatchQuery('  ""  ')).toBe("");
  });
});

describe("parseDate", () => {
  const now = new Date(2026, 9, 22, 15, 30);

  test("accepts relative spans", () => {
    expect(parseDate("7d", false, now)).toBe(new Date(2026, 9, 15, 15, 30).toISOString());
    expect(parseDate("2w", false, now)).toBe(new Date(2026, 9, 8, 15, 30).toISOString());
    expect(parseDate("3m", false, now)).toBe(new Date(2026, 6, 22, 15, 30).toISOString());
    expect(parseDate("1y", false, now)).toBe(new Date(2025, 9, 22, 15, 30).toISOString());
  });

  test("accepts Brazilian and ISO calendar dates in local time", () => {
    expect(parseDate("01/10", false, now)).toBe(new Date(2026, 9, 1).toISOString());
    expect(parseDate("01/10/25", false, now)).toBe(new Date(2025, 9, 1).toISOString());
    expect(parseDate("2026-03-10", false, now)).toBe(new Date(2026, 2, 10).toISOString());
  });

  test("makes --until inclusive by moving to the next midnight", () => {
    expect(parseDate("2026-10-01", true, now)).toBe(new Date(2026, 9, 2).toISOString());
  });

  test("rejects anything else", () => {
    expect(() => parseDate("ontem", false, now)).toThrow(LembraError);
  });
});

test("filterSql builds parameterized clauses only for the filters given", () => {
  const cols = { repo: "s.repo", branch: "s.branch", from: "s.started_at", to: "s.ended_at" };
  expect(filterSql({}, cols)).toEqual({ where: [], params: {} });
  expect(filterSql({ repo: "oro", since: "A", until: "B" }, cols)).toEqual({
    where: ["s.repo LIKE $repo", "s.ended_at >= $since", "s.started_at < $until"],
    params: { repo: "%oro%", since: "A", until: "B" },
  });
});
