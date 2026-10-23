import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDb } from "../../src/core/db";
import { LembraError } from "../../src/core/errors";
import { indexAll } from "../../src/core/indexer";
import { search } from "../../src/core/search";
import { findSession, listFacets, listSessions } from "../../src/core/sessions";
import { createFixture, OTHER_SESSION, seedBillingSession, seedOtherSession, SESSION, type Fixture } from "../support/fixture";

let f: Fixture;
let db: Database;

beforeAll(async () => {
  f = createFixture();
  seedBillingSession(f);
  seedOtherSession(f);
  db = openDb(f.paths.dataDir);
  await indexAll(db, f.paths);
});

afterAll(() => {
  db.close();
  f.cleanup();
});

const ids = (query: string, filters = {}, opts = {}) => search(db, query, filters, { limit: 10, ...opts }).map((hit) => hit.session.id);

describe("search", () => {
  test("ignores accents and case, and marks the matched words", () => {
    const [hit] = search(db, "RELATORIO", {}, { limit: 10 });
    expect(hit!.session.id).toBe(SESSION);
    expect(hit!.snippets[0]!.text).toContain("\x01relatório\x02");
  });

  test("matches word prefixes and session titles", () => {
    expect(ids("fatur")).toEqual([SESSION]);
    const [byTitle] = search(db, "billing", {}, { limit: 10 });
    expect(byTitle).toMatchObject({ session: { id: SESSION }, snippets: [] });
  });

  test("filters by repo, branch and date", () => {
    expect(ids("fila", { repo: "billing" })).toEqual([OTHER_SESSION]);
    expect(ids("fila", { repo: "outro-repo" })).toEqual([]);
    expect(ids("fila", { branch: "fix" })).toEqual([]);
    expect(ids("faturamento", { since: "2026-10-02T00:00:00.000Z" })).toEqual([]);
    expect(ids("faturamento", { until: "2026-10-02T00:00:00.000Z" })).toEqual([SESSION]);
  });

  test("can restrict matches to the user's own prompts", () => {
    expect(ids("correção")).toEqual([SESSION]);
    expect(ids("correção", {}, { promptsOnly: true })).toEqual([]);
  });

  test("returns nothing for an empty query", () => {
    expect(ids('  "" ')).toEqual([]);
  });
});

describe("sessions", () => {
  test("lists the most recent first", () => {
    expect(listSessions(db, {}, 10).map((session) => session.id)).toEqual([OTHER_SESSION, SESSION]);
    expect(listSessions(db, { branch: "main" }, 10).map((session) => session.id)).toEqual([OTHER_SESSION]);
  });

  test("finds a session by id prefix or by its /rename name", () => {
    expect(findSession(db, "11111111").id).toBe(SESSION);
    expect(findSession(db, "Billing-Fix").id).toBe(SESSION);
    expect(() => findSession(db, "1111")).toThrow(/more than one session/);
    expect(() => findSession(db, "zzz")).toThrow(LembraError);
  });
});

test("facets list repos and branches by most recent activity", () => {
  expect(listFacets(db)).toEqual({
    repos: [{ value: "billing-app", sessions: 2 }],
    branches: [
      { value: "main", sessions: 1 },
      { value: "fix/billing", sessions: 1 },
    ],
  });
  expect(listFacets(db, { repo: "nada" }).branches).toEqual([]);
});
