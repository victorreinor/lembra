import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../src/cli/main";
import { archivePath } from "../../src/core/archive";
import { openDb } from "../../src/core/db";
import { indexAll } from "../../src/core/indexer";
import { createMcpHandler } from "../../src/mcp/server";
import { captureIo, createFixture, fakeServices, seedBillingSession, SESSION, type Fixture } from "../support/fixture";

let f: Fixture;
let db: Database;
let seeded: ReturnType<typeof seedBillingSession>;
let handle: ReturnType<typeof createMcpHandler>;

beforeAll(async () => {
  f = createFixture();
  seeded = seedBillingSession(f);
  db = openDb(f.paths.dataDir);
  await indexAll(db, f.paths);
  handle = createMcpHandler({ db, paths: f.paths, services: fakeServices().services, version: "test" });
});

afterAll(() => {
  db.close();
  f.cleanup();
});

const call = async (name: string, args: object = {}) =>
  (await handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })) as any;

describe("MCP handler", () => {
  test("initialize echoes the client's protocol version and describes the server", async () => {
    const reply = (await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } })) as any;
    expect(reply.result).toMatchObject({ protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "lembra" } });
  });

  test("lists tools with JSON schemas", async () => {
    const reply = (await handle({ jsonrpc: "2.0", id: 2, method: "tools/list" })) as any;
    const names = reply.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toEqual(["search_history", "list_sessions", "get_session", "handoff", "list_files", "get_file", "pending_work"]);
    expect(reply.result.tools[0].inputSchema.required).toEqual(["query"]);
  });

  test("search_history finds the session and shows matches in brackets", async () => {
    const text = (await call("search_history", { query: "relatorio" })).result.content[0].text;
    expect(text).toContain(`id: ${SESSION}`);
    expect(text).toContain("[relatório]");
  });

  test("get_session, handoff, list_files and get_file give the details", async () => {
    expect((await call("get_session", { session: "billing-fix" })).result.content[0].text).toContain("[prompt ·");
    expect((await call("handoff", { session: "11111111" })).result.content[0].text).toStartWith("# Handoff: billing-fix");
    expect((await call("list_files", { missing: true })).result.content[0].text).toContain("fix.sql (apagado do disco)");
    expect((await call("get_file", { file: seeded.fixSql })).result.content[0].text).toContain("UPDATE faturas SET total = 2;");
  });

  test("user mistakes come back as tool errors, not protocol errors", async () => {
    const reply = await call("get_session", { session: "zzz" });
    expect(reply.result.isError).toBe(true);
    expect(reply.result.content[0].text).toContain("Nenhuma sessão");
    expect((await call("search_history", {})).result.isError).toBe(true);
  });

  test("unknown methods fail and notifications get no reply", async () => {
    expect(((await handle({ jsonrpc: "2.0", id: 3, method: "resources/list" })) as any).error.code).toBe(-32601);
    expect(await handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
  });
});

test("lembra mcp speaks newline-delimited JSON-RPC over stdio", async () => {
  const proc = Bun.spawn(["bun", "src/cli/index.ts", "mcp"], {
    cwd: join(import.meta.dir, "..", ".."),
    env: { ...process.env, LEMBRA_HOME: f.paths.dataDir, CLAUDE_CONFIG_DIR: f.paths.claudeDir },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
  const lines = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search_history", arguments: { query: "faturamento" } } },
  ];
  proc.stdin.write(lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
  proc.stdin.end();
  const replies = (await new Response(proc.stdout).text()).trim().split("\n").map((line) => JSON.parse(line));
  await proc.exited;
  expect(replies.map((reply) => reply.id)).toEqual([1, 2]);
  expect(replies[1].result.content[0].text).toContain(SESSION);
});

test("lembra hook indexes and archives, and always exits 0", async () => {
  const io = captureIo();
  expect(await run(["hook"], io, f.paths, fakeServices().services)).toBe(0);
  expect(existsSync(archivePath(f.paths, f.transcript))).toBe(true);
});
