import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { join } from "node:path";
import { openDb } from "../../src/core/db";
import { readStoredFile, resolveFile } from "../../src/core/files";
import { indexAll } from "../../src/core/indexer";
import { search } from "../../src/core/search";
import { getSession, sessionMessages } from "../../src/core/sessions";
import { collectStats } from "../../src/core/stats";
import { createMcpHandler } from "../../src/mcp/server";
import { appendJsonl, createFixture, decode, fakeServices, records, seedBillingSession, SESSION, type Fixture } from "../support/fixture";

const TOKEN = `ghp_${"Z9".repeat(18)}`;
let f: Fixture;
let db: Database;
let envFile: string;

beforeEach(async () => {
  f = createFixture();
  seedBillingSession(f);
  envFile = join(f.cwd, ".env");
  const r = records(f.cwd);
  appendJsonl(f.transcript, [
    r.prompt("s1", "2026-10-01T12:00:00.000Z", `o deploy falhou, o token é ${TOKEN} e a base postgres://app:s3cr3t@db:5432/x`),
    r.toolResult("s2", "2026-10-01T12:01:00.000Z", { type: "create", filePath: envFile, content: "DB_PASSWORD=supersecret123\nPORT=3000\n" }),
  ]);
  db = openDb(f.paths.dataDir);
  await indexAll(db, f.paths);
});

afterEach(() => {
  db.close();
  f.cleanup();
});

test("indexed text keeps the context but not the credential", () => {
  const prompt = sessionMessages(db, SESSION).find((message) => message.text.startsWith("o deploy"))!;
  expect(prompt.text).toBe("o deploy falhou, o token é [REDACTED:github-token] e a base postgres://app:[REDACTED:url-password]@db:5432/x");
  expect(search(db, TOKEN, {}, { limit: 5 })).toEqual([]);
  expect(search(db, "s3cr3t", {}, { limit: 5 })).toEqual([]);
  expect(search(db, "deploy redacted", {}, { limit: 5 })[0]!.session.id).toBe(SESSION);
});

test("stored files stay byte-exact for restore, flagged as holding secrets", () => {
  const file = resolveFile(db, envFile);
  expect(file.secrets).toBe(1);
  expect(decode(readStoredFile(db, file))).toBe("DB_PASSWORD=supersecret123\nPORT=3000\n");
  expect(collectStats(db, f.paths)).toMatchObject({ maskedMessages: 1, secretFiles: 1 });
});

test("files read through MCP come back masked", async () => {
  const handle = createMcpHandler({ db, paths: f.paths, services: fakeServices().services, locale: "pt-BR", version: "test" });
  const reply = (await handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_file", arguments: { file: envFile } } })) as any;
  const text: string = reply.result.content[0].text;
  expect(text).toContain("DB_PASSWORD=[REDACTED:env-secret]");
  expect(text).toContain("1 segredo mascarado");
  expect(text).not.toContain("supersecret123");
});

test("databases indexed before masking existed are cleaned on the next run", async () => {
  db.query("UPDATE messages SET text = ? WHERE uid = 's1'").run(`token ${TOKEN}`);
  db.query("UPDATE sessions SET digest = ?, ai_title = NULL, custom_title = NULL WHERE id = ?").run(`resumo com ${TOKEN}`, SESSION);
  db.query("UPDATE files SET secrets = 0").run();
  db.query("UPDATE meta SET value = '0' WHERE key = 'redaction_version'").run();
  expect(search(db, TOKEN, {}, { limit: 5 })).toHaveLength(1);

  await indexAll(db, f.paths);
  expect(search(db, TOKEN, {}, { limit: 5 })).toEqual([]);
  expect(getSession(db, SESSION)!.digest).toBe("resumo com [REDACTED:github-token]");
  expect(resolveFile(db, envFile).secrets).toBe(1);
});
