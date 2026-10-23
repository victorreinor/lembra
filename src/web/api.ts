import type { Database } from "bun:sqlite";
import { basename } from "node:path";
import { LembraError } from "../core/errors";
import { fileStatus, latestFiles, readStoredFile, resolveFile, restoreFile, sessionFiles, type StoredFile } from "../core/files";
import { buildHandoff } from "../core/handoff";
import type { IndexStats } from "../core/indexer";
import type { Paths } from "../core/paths";
import { DEFAULT_PENDING_SINCE, describeReasons, findPending } from "../core/pending";
import { parseFilters } from "../core/query";
import { search } from "../core/search";
import type { Services } from "../core/services";
import { findSession, getSession, listFacets, listSessions, resumeCommand, sessionMessages, type Session } from "../core/sessions";
import { collectStats } from "../core/stats";
import { repoName, shortPath } from "../core/text";
import { runInTerminal } from "../system/os";
import { resolveLocale, type Locale } from "../i18n/locale";
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
  // Language chosen explicitly (lembra lang, LEMBRA_LANG, --lang); null leaves it to each browser.
  chosenLocale(): Locale | null;
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const fail = (error: LembraError, locale: Locale, status: number) => json({ error: error.in(locale) }, status);

export function toSessionDTO(session: Session): SessionDTO {
  return {
    id: session.id,
    title: session.title,
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
    resumeCommand: resumeCommand(session),
  };
}

export function toFileDTO(file: StoredFile): FileDTO {
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
    status: fileStatus(file),
    secrets: file.secrets,
  };
}

const filtersFrom = (params: URLSearchParams) =>
  parseFilters({ repo: params.get("repo"), branch: params.get("branch"), since: params.get("since"), until: params.get("until") });

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

  async function route(req: Request, url: URL, locale: Locale): Promise<Response> {
    const params = url.searchParams;
    const parts = url.pathname.split("/").filter(Boolean).slice(1); // drop "api"
    const [resource, id, action] = parts;
    const get = req.method === "GET";

    if (resource === "health" && get) return json({ app: "lembra", version: VERSION, lang: opts.chosenLocale() });

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
      if (action === "handoff" && get) return json({ text: buildHandoff(db, session, locale) });
      if (action === "terminal" && !get) {
        const command = resumeCommand(session);
        if (!command) throw new LembraError("promptsOnly");
        await runInTerminal(command);
        return json({ ok: true });
      }
    }

    if (resource === "files" && !id && get) {
      const { repo, since } = filtersFrom(params);
      const files = latestFiles(db, { term: params.get("term") || undefined, repo, since, missing: params.get("missing") === "1" });
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
      const since = params.get("since") || DEFAULT_PENDING_SINCE;
      const items = await findPending(db, { since, probe: services.git });
      return json({
        since,
        items: items.map((item) => ({
          repoName: repoName(item.repo),
          branch: item.branch,
          reasons: describeReasons(item, locale),
          sessions: item.sessions,
          lastSession: toSessionDTO(item.lastSession),
        })),
      });
    }

    if (resource === "index" && !get) return json((await opts.refresh()) ?? {});

    return fail(new LembraError("routeNotFound"), locale, 404);
  }

  return {
    async handle(req: Request): Promise<Response> {
      const url = new URL(req.url);
      // The page sends its language; other clients get the chosen one, else English.
      const locale = resolveLocale(url.searchParams.get("lang"), req.headers.get("accept-language")?.split(",")[0], opts.chosenLocale());
      // Only this machine's browser, on the address the page was served from.
      if (!hosts.has(req.headers.get("host") ?? "")) return fail(new LembraError("hostRefused"), locale, 403);
      if (req.method !== "GET") {
        const origin = req.headers.get("origin");
        // A custom header cannot be sent cross-origin without a CORS preflight, which this API never grants.
        if (req.headers.get("x-lembra") !== "1" || (origin && !hosts.has(new URL(origin).host))) return fail(new LembraError("requestRefused"), locale, 403);
      }
      try {
        return await route(req, url, locale);
      } catch (error) {
        if (error instanceof LembraError) return fail(error, locale, 400);
        console.error(error);
        return fail(new LembraError("internalError"), locale, 500);
      }
    },
  };
}
