import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { openDb } from "../../src/core/db";
import { indexAll } from "../../src/core/indexer";
import { createApi } from "../../src/web/api";
import { startServer } from "../../src/web/server";
import type { FileDTO } from "../../src/web/types";
import { createFixture, fakeServices, seedBillingSession, SESSION, type Fixture } from "../support/fixture";

const HOST = "localhost:4747";
let f: Fixture;
let db: Database;
let seeded: ReturnType<typeof seedBillingSession>;
let api: ReturnType<typeof createApi>;

beforeAll(async () => {
  f = createFixture();
  seeded = seedBillingSession(f);
  db = openDb(f.paths.dataDir);
  await indexAll(db, f.paths);
  const services = fakeServices({ facts: { "fix/billing": { exists: true, upstream: false, ahead: 0, dirty: false, pr: "NONE" } } }).services;
  api = createApi({ db, paths: f.paths, services, hosts: [HOST], refresh: async () => undefined, lastIndexedAt: () => null });
});

afterAll(() => {
  db.close();
  f.cleanup();
});

const send = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
  api.handle(new Request(`http://${HOST}${path}`, { ...init, headers: { host: HOST, ...init.headers } }));
const get = async (path: string) => (await send(path)).json() as Promise<any>;
const post = (path: string, body?: object) => send(path, { method: "POST", headers: { "x-lembra": "1" }, body: body && JSON.stringify(body) });

describe("guards", () => {
  test("refuses requests addressed to another host (DNS rebinding)", async () => {
    const res = await api.handle(new Request(`http://evil.test/api/health`, { headers: { host: "evil.test" } }));
    expect(res.status).toBe(403);
  });

  test("refuses writes without the x-lembra header or from another origin", async () => {
    expect((await send(`/api/files/1/restore`, { method: "POST" })).status).toBe(403);
    const foreign = await send(`/api/files/1/restore`, { method: "POST", headers: { "x-lembra": "1", origin: "https://evil.test" } });
    expect(foreign.status).toBe(403);
  });
});

describe("read endpoints", () => {
  test("health identifies the app", async () => {
    expect(await get("/api/health")).toMatchObject({ app: "lembra" });
  });

  test("search ranks sessions and keeps the match markers", async () => {
    const body = await get("/api/search?q=relatorio");
    expect(body.mode).toBe("search");
    expect(body.results[0].session).toMatchObject({ id: SESSION, title: "billing-fix", repoName: "billing-app" });
    expect(body.results[0].snippets[0].text).toContain("\x01relatório\x02");
  });

  test("search without a query lists recent sessions", async () => {
    const body = await get("/api/search?since=2026-01-01");
    expect(body.mode).toBe("recent");
    expect(body.results[0].session.resumeCommand).toContain(`claude --resume ${SESSION}`);
  });

  test("session detail brings messages and files with their disk status", async () => {
    const body = await get("/api/sessions/billing-fix");
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["prompt"]);
    const fix = body.files.find((file: FileDTO) => file.path === seeded.fixSql);
    expect(fix).toMatchObject({ kind: "edit", status: "missing", versions: 2 });
    expect((await get("/api/sessions/billing-fix?replies=1")).messages).toHaveLength(2);
  });

  test("unknown sessions explain themselves", async () => {
    const res = await send("/api/sessions/zzz");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Nenhuma sessão");
  });

  test("handoff, files, facets, stats and pending", async () => {
    expect((await get(`/api/sessions/${SESSION}/handoff`)).text).toStartWith("# Handoff: billing-fix");
    const files = await get("/api/files?missing=1");
    expect(files.files.map((file: FileDTO) => file.displayPath.split("/").pop()).sort()).toEqual(["dump.sql", "fix.sql"]);
    expect((await get("/api/facets")).repos).toEqual([{ value: "billing-app", sessions: 1 }]);
    expect(await get("/api/stats")).toMatchObject({ sessions: 1, missing: 2, indexedAt: null });
    expect((await get("/api/pending?since=2026-01-01")).items[0]).toMatchObject({ branch: "fix/billing", reasons: ["branch nunca enviada", "sem PR"] });
  });

  test("raw content is served inline or as a download", async () => {
    const files = await get("/api/files?term=dump");
    const id = files.files[0].id;
    const inline = await send(`/api/files/${id}/raw`);
    expect(await inline.text()).toBe("INSERT INTO faturas VALUES (1);");
    expect(inline.headers.get("content-type")).toStartWith("text/plain");
    expect((await send(`/api/files/${id}/raw?download=1`)).headers.get("content-disposition")).toBe('attachment; filename="dump.sql"');
  });

  test("unknown routes are 404", async () => {
    expect((await send("/api/nope")).status).toBe(404);
  });
});

test("restore writes the file back and refuses to overwrite it", async () => {
  const id = (await get("/api/files?term=fix.sql")).files[0].id;
  const res = await post(`/api/files/${id}/restore`);
  expect(res.status).toBe(200);
  expect((await res.json()).dest).toBe(seeded.fixSql);
  expect(readFileSync(seeded.fixSql, "utf8")).toBe("UPDATE faturas SET total = 2;\n");
  const again = await post(`/api/files/${id}/restore`);
  expect(again.status).toBe(400);
  expect((await again.json()).error).toContain("já existe");
});

test("the server bundles the page and serves manifest, icons and the API on loopback", async () => {
  const server = startServer({ db, paths: f.paths, services: fakeServices().services, port: 0 });
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const html = await (await fetch(`${base}/`)).text();
    expect(html).toContain("<title>lembra</title>");
    expect(html).toMatch(/<script[^>]+src="[^"]+\.js"/);
    expect((await (await fetch(`${base}/manifest.webmanifest`)).json()).name).toBe("lembra");
    expect((await fetch(`${base}/icons/icon-192.png`)).headers.get("content-type")).toBe("image/png");
    expect((await fetch(`${base}/icons/../../secret`)).status).toBe(404);
    expect((await (await fetch(`${base}/api/health`)).json()).app).toBe("lembra");
  } finally {
    server.stop();
  }
});
