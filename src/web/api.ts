import type { Database } from "bun:sqlite";
import { basename, isAbsolute } from "node:path";
import { LembraError } from "../core/errors";
import { isMissing, latestFiles, readStoredFile, resolveFile, restoreFile, sessionFiles, type StoredFile } from "../core/files";
import { buildHandoff } from "../core/handoff";
import type { IndexStats } from "../core/indexer";
import type { Paths } from "../core/paths";
import { describeReasons, findPending } from "../core/pending";
import { parseDate, type Filters } from "../core/query";
import { search } from "../core/search";
import type { Services } from "../core/services";
import { findSession, getSession, listFacets, listSessions, resumeCommand, sessionMessages, type Session } from "../core/sessions";
import { collectStats } from "../core/stats";
import { repoName, shortPath } from "../core/text";
import { runInTerminal } from "../system/os";
import { VERSION } from "../version";
import type { FileDTO, SessionDTO } from "./types";

export interface ApiOptions {
  db: Database;
  paths: Paths;
  services: Services;
  // host:port values the page may be served from; anything else is refused (DNS rebinding).
  hosts: string[];
  // Picks up what Claude Code wrote since the last call; the server debounces it.
  refresh(): Promise<IndexStats | void>;
  lastIndexedAt(): string | null;
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const fail = (message: string, status: number) => json({ error: message }, status);

export function toSessionDTO(session: Session): SessionDTO {
  return {
    id: session.id,
    title: session.title ?? "(sem título)",
    repo: session.repo,
    repoName: repoName(session.repo),
    branch: session.branch,
    cwd: session.cwd,
    startedAt: session.started_at,
    endedAt: session.ended_at,
    promptCount: session.prompt_count,
    source: session.source,
    costUsd: session.cost_usd,
    linesAdded: session.lines_added,
    linesRemoved: session.lines_removed,
    digest: session.digest,
    lastPrompt: session.last_prompt,
    resumeCommand: session.source === "transcript" ? resumeCommand(session) : null,
  };
}

export function toFileDTO(file: StoredFile): FileDTO {
  const status = !file.sha ? "partial" : !isAbsolute(file.path) ? "image" : isMissing(file) ? "missing" : "disk";
  return {
    id: file.id,
    path: file.path,
    displayPath: shortPath(file.path),
    kind: file.kind,
    ts: file.ts,
    size: file.size,
    repoName: repoName(file.repo),
    sessionId: file.session_id,
    versions: file.versions,
    status,
  };
}

function filtersFrom(params: URLSearchParams): Filters {
  const since = params.get("since");
  const until = params.get("until");
  return {
    repo: params.get("repo") || undefined,
    branch: params.get("branch") || undefined,
    since: since ? parseDate(since) : undefined,
    until: until ? parseDate(until, true) : undefined,
  };
}

function limitFrom(params: URLSearchParams, fallback: number): number {
  const limit = Number(params.get("limit") ?? fallback);
  return Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : fallback;
}

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "text/plain; charset=utf-8",
  pdf: "application/pdf",
};

function contentType(path: string, data: Uint8Array): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (CONTENT_TYPES[ext]) return CONTENT_TYPES[ext];
  return data.includes(0) ? "application/octet-stream" : "text/plain; charset=utf-8";
}

export function createApi(opts: ApiOptions) {
  const { db, paths, services } = opts;
  const hosts = new Set(opts.hosts);

  async function route(req: Request, url: URL): Promise<Response> {
    const params = url.searchParams;
    const parts = url.pathname.split("/").filter(Boolean).slice(1); // drop "api"
    const [resource, id, action] = parts;
    const get = req.method === "GET";

    if (resource === "health" && get) return json({ app: "lembra", version: VERSION });

    if (resource === "search" && get) {
      await opts.refresh();
      const started = performance.now();
      const query = params.get("q")?.trim() ?? "";
      const filters = filtersFrom(params);
      const limit = limitFrom(params, 40);
      const results = query
        ? search(db, query, filters, { promptsOnly: params.get("prompts") === "1", limit }).map((hit) => ({
            session: toSessionDTO(hit.session),
            snippets: hit.snippets,
          }))
        : listSessions(db, filters, limit).map((session) => ({ session: toSessionDTO(session), snippets: [] }));
      return json({ mode: query ? "search" : "recent", results, tookMs: Math.round(performance.now() - started) });
    }

    if (resource === "sessions" && id) {
      const session = findSession(db, decodeURIComponent(id));
      if (!action && get) {
        const messages = sessionMessages(db, session.id, { replies: params.get("replies") === "1" });
        const files = sessionFiles(db, session.id).map(toFileDTO);
        return json({ session: toSessionDTO(session), messages, files });
      }
      if (action === "handoff" && get) return json({ text: buildHandoff(db, session) });
      if (action === "terminal" && !get) {
        if (session.source !== "transcript") throw new LembraError("Esta sessão só tem os prompts; use o handoff para continuar.");
        await runInTerminal(resumeCommand(session));
        return json({ ok: true });
      }
    }

    if (resource === "files" && !id && get) {
      const since = params.get("since");
      let files = latestFiles(db, { term: params.get("term") || undefined, repo: params.get("repo") || undefined, since: since ? parseDate(since) : undefined });
      if (params.get("missing") === "1") files = files.filter(isMissing);
      return json({ files: files.slice(0, limitFrom(params, 100)).map(toFileDTO), total: files.length });
    }

    if (resource === "files" && id) {
      const file = resolveFile(db, id);
      if (action === "raw" && get) {
        const data = readStoredFile(db, file);
        const headers: Record<string, string> = { "content-type": contentType(file.path, data), "cache-control": "no-store" };
        if (params.get("download") === "1") headers["content-disposition"] = `attachment; filename="${basename(file.path).replaceAll('"', "")}"`;
        return new Response(data as Uint8Array<ArrayBuffer>, { headers });
      }
      if (action === "restore" && !get) {
        const body = (await req.json().catch(() => ({}))) as { to?: string; force?: boolean };
        const { dest } = await restoreFile(db, String(file.id), { to: body.to || undefined, force: body.force === true });
        return json({ dest, displayDest: shortPath(dest) });
      }
    }

    if (resource === "facets" && get) return json(listFacets(db, { repo: params.get("repo") || undefined }));

    if (resource === "stats" && get) {
      const stats = collectStats(db, paths);
      return json({ ...stats, indexedAt: opts.lastIndexedAt(), version: VERSION });
    }

    if (resource === "pending" && get) {
      const items = await findPending(db, { since: parseDate(params.get("since") || "14d"), probe: services.git });
      return json({
        items: items.map((item) => ({
          repoName: repoName(item.repo),
          branch: item.branch,
          reasons: describeReasons(item),
          sessions: item.sessions,
          lastSession: toSessionDTO(getSession(db, item.lastSession.id) ?? item.lastSession),
        })),
      });
    }

    if (resource === "index" && !get) return json((await opts.refresh()) ?? {});

    return fail("Rota não encontrada.", 404);
  }

  return {
    async handle(req: Request): Promise<Response> {
      const url = new URL(req.url);
      // Only this machine's browser, on the address the page was served from.
      if (!hosts.has(req.headers.get("host") ?? "")) return fail("Host não permitido.", 403);
      if (req.method !== "GET") {
        const origin = req.headers.get("origin");
        // A custom header cannot be sent cross-origin without a CORS preflight, which this API never grants.
        if (req.headers.get("x-lembra") !== "1" || (origin && !hosts.has(new URL(origin).host))) return fail("Requisição recusada.", 403);
      }
      try {
        return await route(req, url);
      } catch (error) {
        if (error instanceof LembraError) return fail(error.message, 400);
        console.error(error);
        return fail("Erro interno; veja o terminal do lembra.", 500);
      }
    },
  };
}
