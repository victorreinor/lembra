import type { Database } from "bun:sqlite";
import { join } from "node:path";
import { indexAll, type IndexStats } from "../core/indexer";
import type { Paths } from "../core/paths";
import type { Services } from "../core/services";
import type { Locale } from "../i18n/locale";
import { localeChoice } from "../i18n/system";
import { createApi } from "./api";
import page from "./ui/index.html";

const ICONS_DIR = join(import.meta.dir, "ui", "icons");
const ICONS = new Set(["icon-192.png", "icon-512.png", "icon.svg"]);
// Requests within this window reuse the last indexing pass instead of starting another.
const FRESH_FOR_MS = 5_000;
const BACKGROUND_EVERY_MS = 60_000;

export const MANIFEST = {
  name: "lembra",
  short_name: "lembra",
  description: "Permanent, searchable history for Claude Code",
  start_url: "/",
  display: "standalone",
  background_color: "#f4f1ea",
  theme_color: "#3048c9",
  icons: [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" },
  ],
};

export interface ServerOptions {
  db: Database;
  paths: Paths;
  services: Services;
  port: number;
  // Set by `lembra ui --lang`; otherwise LEMBRA_LANG or `lembra lang`, read on every request.
  locale?: Locale;
}

export function startServer(opts: ServerOptions) {
  let indexedAt: string | null = null;
  let lastRun = 0;
  let running: Promise<IndexStats> | null = null;

  // Single flight: concurrent requests share one incremental pass.
  const index = () =>
    (running ??= indexAll(opts.db, opts.paths)
      .then((stats) => {
        indexedAt = new Date().toISOString();
        lastRun = Date.now();
        return stats;
      })
      .finally(() => {
        running = null;
      }));
  const refresh = async () => (Date.now() - lastRun < FRESH_FOR_MS ? undefined : index());

  let api: ReturnType<typeof createApi>;
  const server = Bun.serve({
    // Loopback only: the vault never listens on the network.
    hostname: "127.0.0.1",
    port: opts.port,
    development: false,
    routes: {
      "/": page,
      "/manifest.webmanifest": () => new Response(JSON.stringify(MANIFEST), { headers: { "content-type": "application/manifest+json" } }),
      "/icons/:name": (req) => (ICONS.has(req.params.name) ? new Response(Bun.file(join(ICONS_DIR, req.params.name))) : new Response(null, { status: 404 })),
      "/api/*": (req) => api.handle(req),
    },
    fetch: () => new Response("Not found", { status: 404 }),
  });
  api = createApi({
    db: opts.db,
    paths: opts.paths,
    services: opts.services,
    hosts: [`127.0.0.1:${server.port}`, `localhost:${server.port}`],
    refresh,
    lastIndexedAt: () => indexedAt,
    // An explicit choice (flag, LEMBRA_LANG, `lembra lang`) wins over the browser's language.
    chosenLocale: () => {
      const choice = localeChoice({ flag: opts.locale, dataDir: opts.paths.dataDir });
      return choice.source === "system" ? null : choice.locale;
    },
  });

  void index();
  const timer = setInterval(() => void index(), BACKGROUND_EVERY_MS);
  return {
    url: `http://localhost:${server.port}`,
    port: server.port,
    stop() {
      clearInterval(timer);
      server.stop(true);
    },
  };
}

// True when a lembra server already answers on this port (started by launchd or another terminal).
export async function isServerRunning(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(600), headers: { host: `127.0.0.1:${port}` } });
    return res.ok && (await res.json()).app === "lembra";
  } catch {
    return false;
  }
}
