import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { appendFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { archivePath, restoreTranscript } from "../../src/core/archive";
import { openDb } from "../../src/core/db";
import { readStoredFile, resolveFile } from "../../src/core/files";
import { indexAll } from "../../src/core/indexer";
import { getSession, sessionMessages } from "../../src/core/sessions";
import {
  appendJsonl,
  createFixture,
  decode,
  OLD_SESSION,
  records,
  seedBillingSession,
  SESSION,
  writeJsonl,
  type Fixture,
} from "../support/fixture";

let f: Fixture;
let db: Database;

beforeEach(() => {
  f = createFixture();
  db = openDb(f.paths.dataDir);
});

afterEach(() => {
  db.close();
  f.cleanup();
});

describe("indexAll", () => {
  test("indexes human prompts and replies, skipping commands, notifications and meta records", async () => {
    seedBillingSession(f);
    const stats = await indexAll(db, f.paths);
    expect(stats).toMatchObject({ scanned: 1, changed: 1, messages: 2 });
    expect(sessionMessages(db, SESSION, { replies: true }).map((m) => m.role)).toEqual(["prompt", "reply"]);
  });

  test("summarizes the session", async () => {
    seedBillingSession(f);
    await indexAll(db, f.paths);
    expect(getSession(db, SESSION)).toMatchObject({
      source: "transcript",
      title: "billing-fix",
      ai_title: "Corrigir faturamento",
      repo: "billing-app",
      branch: "fix/billing",
      prompt_count: 1,
      cost_usd: 1.25,
      lines_added: 10,
      lines_removed: 2,
      started_at: "2026-10-01T10:00:00.000Z",
      ended_at: "2026-10-01T10:01:00.000Z",
    });
  });

  test("reconstructs the full content of edited files", async () => {
    const { fixSql } = seedBillingSession(f);
    await indexAll(db, f.paths);
    const file = resolveFile(db, fixSql);
    expect(file).toMatchObject({ kind: "edit", versions: 2 });
    expect(decode(readStoredFile(db, file))).toBe("UPDATE faturas SET total = 2;\n");
  });

  test("keeps files read outside the repo and files named in prompts", async () => {
    const { report, dump } = seedBillingSession(f);
    await indexAll(db, f.paths);
    expect(decode(readStoredFile(db, resolveFile(db, dump)))).toBe("INSERT INTO faturas VALUES (1);");
    expect(resolveFile(db, report).kind).toBe("ref");
    expect(decode(readStoredFile(db, resolveFile(db, report)))).toBe("SELECT * FROM faturas;\n");
  });

  test("is incremental and idempotent", async () => {
    seedBillingSession(f);
    await indexAll(db, f.paths);
    expect((await indexAll(db, f.paths)).changed).toBe(0);

    appendJsonl(f.transcript, [records(f.cwd).prompt("u8", "2026-10-02T09:00:00.000Z", "agora gere o relatório mensal")]);
    expect(await indexAll(db, f.paths)).toMatchObject({ changed: 1, messages: 1 });
    expect(getSession(db, SESSION)).toMatchObject({ prompt_count: 2, last_prompt: "agora gere o relatório mensal" });
  });

  test("counts messages typed while Claude was working as prompts", async () => {
    seedBillingSession(f);
    appendJsonl(f.transcript, [records(f.cwd).queued("q1", "2026-10-01T10:00:07.000Z", "e o relatório de outubro?")]);
    await indexAll(db, f.paths);
    expect(getSession(db, SESSION)!.prompt_count).toBe(2);
  });

  test("re-reads every transcript after a parser upgrade without duplicating", async () => {
    seedBillingSession(f);
    await indexAll(db, f.paths);
    db.query("UPDATE meta SET value = '0' WHERE key = 'parser_version'").run();
    expect(await indexAll(db, f.paths)).toMatchObject({ changed: 1, messages: 0, files: 0 });
    expect(getSession(db, SESSION)!.prompt_count).toBe(1);
  });

  test("leaves a half-written line for the next run", async () => {
    seedBillingSession(f);
    const line = JSON.stringify(records(f.cwd).prompt("u9", "2026-10-02T09:00:00.000Z", "linha completa"));
    appendFileSync(f.transcript, line.slice(0, 40));
    await indexAll(db, f.paths);
    expect(getSession(db, SESSION)!.prompt_count).toBe(1);

    appendFileSync(f.transcript, `${line.slice(40)}\n`);
    await indexAll(db, f.paths);
    expect(getSession(db, SESSION)!.prompt_count).toBe(2);
  });

  test("attributes subagent file writes to the parent session", async () => {
    seedBillingSession(f);
    const helper = join(f.cwd, "helper.ts");
    const agentLog = join(dirname(f.transcript), SESSION, "subagents", "agent-abc.jsonl");
    const write = records(f.cwd).toolResult("s1", "2026-10-01T10:02:00.000Z", { type: "create", filePath: helper, content: "export {};\n" });
    writeJsonl(agentLog, [{ ...write, isSidechain: true }]);
    await indexAll(db, f.paths);
    expect(resolveFile(db, helper).session_id).toBe(SESSION);
    expect(getSession(db, SESSION)!.prompt_count).toBe(1);
  });

  test("imports history.jsonl prompts only for sessions whose transcript is gone", async () => {
    seedBillingSession(f);
    writeJsonl(join(f.paths.claudeDir, "history.jsonl"), [
      { display: "como funcionava o faturamento?", pastedContents: {}, timestamp: Date.parse("2026-03-10T12:00:00Z"), project: f.cwd, sessionId: OLD_SESSION },
      {
        display: "[Pasted text #1 +3 lines]",
        pastedContents: { 1: { id: 1, type: "text", content: "log de erro do worker" } },
        timestamp: Date.parse("2026-03-10T12:05:00Z"),
        project: f.cwd,
        sessionId: OLD_SESSION,
      },
      { display: "preciso corrigir o relatório", pastedContents: {}, timestamp: Date.parse("2026-10-01T10:00:00Z"), project: f.cwd, sessionId: SESSION },
    ]);
    expect((await indexAll(db, f.paths)).history).toBe(2);
    expect(getSession(db, OLD_SESSION)).toMatchObject({ source: "history", prompt_count: 2, repo: "billing-app" });
    expect(sessionMessages(db, OLD_SESSION)[1]!.text).toContain("log de erro do worker");
    expect(getSession(db, SESSION)!.prompt_count).toBe(1);
  });

  test("archives raw transcripts and puts a deleted one back", async () => {
    seedBillingSession(f);
    const original = readFileSync(f.transcript, "utf8");
    await indexAll(db, f.paths, { archive: true });
    expect(existsSync(archivePath(f.paths, f.transcript))).toBe(true);

    rmSync(f.transcript);
    expect(await restoreTranscript(db, f.paths, SESSION)).toBe("restored");
    expect(readFileSync(f.transcript, "utf8")).toBe(original);
    expect(await restoreTranscript(db, f.paths, SESSION)).toBe("present");
    expect(await restoreTranscript(db, f.paths, OLD_SESSION)).toBe("unavailable");
  });
});
