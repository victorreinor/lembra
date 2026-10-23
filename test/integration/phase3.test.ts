import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDb } from "../../src/core/db";
import { buildHandoff } from "../../src/core/handoff";
import { indexAll } from "../../src/core/indexer";
import { findPending } from "../../src/core/pending";
import { search } from "../../src/core/search";
import { getSession } from "../../src/core/sessions";
import { sessionsToSummarize, summarizeSession } from "../../src/core/summarize";
import {
  appendJsonl,
  createFixture,
  fakeServices,
  OTHER_SESSION,
  records,
  seedBillingSession,
  seedOtherSession,
  SESSION,
  type Fixture,
} from "../support/fixture";

let f: Fixture;
let db: Database;

beforeEach(async () => {
  f = createFixture();
  seedBillingSession(f);
  appendJsonl(f.transcript, [
    records(f.cwd).prompt("u8", "2026-10-01T11:00:00.000Z", "agora gere o relatório mensal"),
    records(f.cwd).reply("a8", "2026-10-01T11:00:30.000Z", "Relatório mensal pronto em relatorio-mensal.sql."),
  ]);
  seedOtherSession(f);
  db = openDb(f.paths.dataDir);
  await indexAll(db, f.paths);
});

afterEach(() => {
  db.close();
  f.cleanup();
});

describe("handoff", () => {
  test("brings goal, latest requests, where it stopped and the files to read", () => {
    const text = buildHandoff(db, getSession(db, SESSION)!, "pt-BR");
    expect(text).toStartWith("# Handoff: billing-fix");
    expect(text).toContain(`claude --resume ${SESSION}`);
    expect(text).toContain("## Pedido inicial\n\n> preciso corrigir o relatório de faturamento");
    expect(text).toContain("agora gere o relatório mensal");
    expect(text).toContain("> Relatório mensal pronto em relatorio-mensal.sql.");
    expect(text).toMatch(/`.*fix\.sql` \(edit, apagado do disco\) → `lembra cat \d+`/);
  });
});

describe("summaries", () => {
  test("pick finished sessions with real back-and-forth", () => {
    const later = new Date("2026-12-01T00:00:00Z");
    expect(sessionsToSummarize(db, { limit: 10, now: later }).map((s) => s.id)).toEqual([SESSION]);
    expect(sessionsToSummarize(db, { limit: 10, now: new Date("2026-10-01T11:10:00Z") })).toEqual([]);
  });

  test("are stored on the session and become searchable", async () => {
    const { services, prompts } = fakeServices({ digest: () => "Objetivo: conciliar notas do ERP Protheus." });
    await summarizeSession(db, getSession(db, SESSION)!, services.summarizer("haiku"), "pt-BR");
    expect(prompts[0]).toContain("[usuário] preciso corrigir o relatório");
    expect(getSession(db, SESSION)!.digest).toBe("Objetivo: conciliar notas do ERP Protheus.");
    expect(search(db, "protheus", {}, { limit: 5 })[0]!.snippets[0]!.role).toBe("digest");
    expect(sessionsToSummarize(db, { limit: 10, now: new Date("2026-12-01T00:00:00Z") })).toEqual([]);
  });

  test("are redone when the session continues afterwards", async () => {
    const { services } = fakeServices();
    await summarizeSession(db, getSession(db, SESSION)!, services.summarizer("haiku"), "pt-BR");
    db.query("UPDATE sessions SET digest_at = '2026-10-01T00:00:00.000Z' WHERE id = ?").run(SESSION);
    expect(sessionsToSummarize(db, { limit: 10, now: new Date("2026-12-01T00:00:00Z") }).map((s) => s.id)).toEqual([SESSION]);
    await summarizeSession(db, getSession(db, SESSION)!, services.summarizer("haiku"), "pt-BR");
    expect(db.query("SELECT count(*) AS n FROM messages WHERE role = 'digest'").get()).toEqual({ n: 1 });
  });
});

describe("pending work", () => {
  test("reports feature branches whose work is not merged", async () => {
    const { services } = fakeServices({
      facts: { "fix/billing": { exists: true, upstream: false, ahead: 0, dirty: true, pr: "NONE" } },
    });
    const items = await findPending(db, { since: "2026-01-01T00:00:00.000Z", probe: services.git });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ branch: "fix/billing", reasons: ["no-push", "dirty", "no-pr"], sessions: 1 });
    expect(items[0]!.lastSession.id).toBe(SESSION);
  });

  test("ignores mainline branches and merged work", async () => {
    const { services } = fakeServices();
    expect(await findPending(db, { since: "2026-01-01T00:00:00.000Z", probe: services.git })).toEqual([]);
    expect(getSession(db, OTHER_SESSION)!.branch).toBe("main");
  });
});
