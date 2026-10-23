import type { FacetsResponse, SearchResponse, SessionDetailResponse } from "../types";
import { Button, whileBusy } from "./components/button/button";
import { DayDivider } from "./components/day-divider/day-divider";
import { EmptyState } from "./components/empty-state/empty-state";
import { FileRow } from "./components/file-row/file-row";
import { FilterBar } from "./components/filter-bar/filter-bar";
import { HelpDialog } from "./components/help-dialog/help-dialog";
import { Kbd } from "./components/kbd/kbd";
import { PendingList } from "./components/pending-list/pending-list";
import { SearchBar } from "./components/search-bar/search-bar";
import { SessionCard } from "./components/session-card/session-card";
import { SessionDetail } from "./components/session-detail/session-detail";
import { Skeleton } from "./components/skeleton/skeleton";
import { StatusBar } from "./components/status-bar/status-bar";
import { Tabs } from "./components/tabs/tabs";
import { toast } from "./components/toast/toast";
import { api } from "./lib/api";
import { h, replace, type Child } from "./lib/dom";
import { count, dayKey, dayStamp } from "./lib/format";
import { bindShortcuts } from "./lib/keyboard";
import { CLEARED_FILTERS, createStore, fromSearch, hasActiveFilters, type State, type View } from "./lib/state";

const SEARCH_DEBOUNCE_MS = 160;
const META_EVERY_MS = 30_000;
const THEME_KEY = "lembra:theme";
const LIST_KEYS: (keyof State)[] = ["view", "q", "repo", "branch", "since", "prompts", "missing"];
const PLACEHOLDERS: Record<View, string> = {
  sessions: "Buscar em prompts, respostas e títulos…",
  files: "Filtrar arquivos pelo caminho (ex.: .sql, relatorio)…",
  pending: "A visão de pendências não usa busca",
};
// Opening Terminal.app is a macOS feature of the local server.
const canOpenTerminal = /Mac/.test(navigator.userAgent);

const store = createStore(fromSearch(location.search));
let facets: FacetsResponse = { repos: [], branches: [] };
let detail: SessionDetailResponse | null = null;
let showReplies = false;
let firstLoad = true;
let listRequest: AbortController | null = null;
let searchTimer: ReturnType<typeof setTimeout> | undefined;

// ── theme ───────────────────────────────────────────────────────────────
function storedTheme(): string | null {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

function applyTheme(theme: string | null) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = current === "dark" ? "light" : "dark";
  applyTheme(next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Private windows may refuse storage; the theme still applies for this visit.
  }
}

applyTheme(storedTheme());

// ── layout ──────────────────────────────────────────────────────────────
const searchBar = SearchBar({
  value: store.get().q,
  placeholder: PLACEHOLDERS[store.get().view],
  onInput: (q) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => store.set({ q }), SEARCH_DEBOUNCE_MS);
  },
  onArrowDown: () => moveSelection(1),
});
const tabs = Tabs<View>({
  items: [
    { id: "sessions", label: "Sessões", key: "1" },
    { id: "files", label: "Arquivos", key: "2" },
    { id: "pending", label: "Pendências", key: "3" },
  ],
  active: store.get().view,
  onChange: (view) => setView(view),
});
const filters = FilterBar({ onChange: (patch) => store.set(patch) });
const help = HelpDialog();
const status = StatusBar({ onToggleTheme: toggleTheme, onHelp: help.open });
const listHeader = h("div", { class: "list-header" });
const list = h("ol", { class: "results", "aria-label": "Resultados" });
const detailPane = h("section", { class: "detail-pane", "aria-label": "Detalhes da sessão", tabindex: "-1" });
const main = h("main", { class: "app-main", dataset: { view: store.get().view } }, h("section", { class: "list-pane" }, listHeader, list), detailPane);
const header = h(
  "header",
  { class: "app-header" },
  h(
    "a",
    { class: "brand", href: "/", "aria-label": "lembra, início" },
    h("img", { class: "brand__mark", src: "/icons/icon.svg", alt: "", width: "30", height: "30" }),
    h("span", { class: "brand__name" }, "lembra"),
  ),
  searchBar.el,
  tabs.el,
);

document.getElementById("app")!.replaceWith(h("div", { class: "app" }, header, h("div", { class: "app-filters" }, filters.el), main, status.el));
document.body.append(help.el);
// Added at runtime: the bundler would try to resolve it as a file, but the server generates it.
document.head.append(h("link", { rel: "manifest", href: "/manifest.webmanifest" }));

// The detail pane sticks right below the header, whatever height it wraps to.
new ResizeObserver(() => document.documentElement.style.setProperty("--header-offset", `${header.offsetHeight}px`)).observe(header);

// ── list ────────────────────────────────────────────────────────────────
function clearFiltersButton() {
  return Button({ label: "Limpar filtros", icon: "close", onClick: () => store.set(CLEARED_FILTERS) });
}

function showMessage(...children: Child[]) {
  replace(list, h("li", { class: "results__message" }, children));
}

async function loadList() {
  const state = store.get();
  listRequest?.abort();
  const request = (listRequest = new AbortController());
  main.setAttribute("aria-busy", "true");
  if (firstLoad) replace(list, Skeleton(6));
  try {
    if (state.view === "sessions") {
      renderSessions(await api.search({ q: state.q, repo: state.repo, branch: state.branch, since: state.since, prompts: state.prompts }, request.signal));
    } else if (state.view === "files") {
      const response = await api.files({ term: state.q, repo: state.repo, since: state.since, missing: state.missing }, request.signal);
      replace(listHeader, h("span", null, `${count(response.total, "arquivo", "arquivos")}${response.total > response.files.length ? ` · mostrando ${response.files.length}` : ""}`));
      if (!response.files.length) {
        showMessage(EmptyState({ icon: "file", title: "Nenhum arquivo", text: "Tente outro trecho do caminho ou remova os filtros.", action: hasActiveFilters(state) ? clearFiltersButton() : undefined }));
      } else {
        replace(list, response.files.map((file) => FileRow({ file, showRepo: true, rawUrl: api.rawUrl, onRestore: (id) => api.restore(id) })));
      }
    } else {
      replace(listHeader, h("span", null, "Consultando git e GitHub…"));
      const response = await api.pending(state.since || "14d", request.signal);
      replace(listHeader, h("span", null, `${count(response.items.length, "branch com trabalho não entregue", "branches com trabalho não entregue")} · ${state.since ? `últimos ${state.since}` : "últimos 14 dias"}`));
      if (!response.items.length) {
        showMessage(EmptyState({ icon: "branch", tone: "success", title: "Nada pendente", text: "Toda branch com sessão recente foi enviada e tem PR." }));
      } else {
        replace(list, h("li", { class: "results__message" }, PendingList({ items: response.items, onOpenSession: (id) => store.set({ view: "sessions", session: id }, "push") })));
      }
    }
  } catch (error) {
    if ((error as Error).name === "AbortError") return;
    showMessage(EmptyState({ icon: "alert", title: "Não deu para carregar", text: (error as Error).message, action: Button({ label: "Tentar de novo", onClick: () => void loadList() }) }));
  } finally {
    if (listRequest === request) main.removeAttribute("aria-busy");
    firstLoad = false;
  }
}

function renderSessions(response: SearchResponse) {
  const state = store.get();
  const n = response.results.length;
  replace(
    listHeader,
    h("span", null, response.mode === "search" ? count(n, "sessão", "sessões") : `${count(n, "sessão recente", "sessões recentes")}`),
    response.mode === "search" && h("span", null, `${response.tookMs} ms`),
  );
  if (!n) {
    const text = response.mode === "search" ? "Use menos palavras ou um prefixo: “fatur” acha “faturamento”." : "Ainda não há sessões indexadas.";
    showMessage(
      EmptyState({
        icon: "search",
        title: response.mode === "search" ? `Nada encontrado para “${state.q}”` : "Nenhuma sessão",
        text,
        action: hasActiveFilters(state) ? clearFiltersButton() : undefined,
      }),
    );
    return;
  }
  const items: HTMLElement[] = [];
  let lastDay = "";
  response.results.forEach((result, index) => {
    // Recent sessions read as a diary, grouped by day; search results stay in relevance order.
    if (response.mode === "recent" && dayKey(result.session.endedAt) !== lastDay) {
      lastDay = dayKey(result.session.endedAt);
      items.push(DayDivider(dayStamp(result.session.endedAt)));
    }
    items.push(SessionCard({ result, index, selected: result.session.id === state.session, onSelect: (id) => selectSession(id, "push") }));
  });
  replace(list, items);
}

function selectSession(id: string, history: "push" | "replace") {
  if (store.get().session !== id) store.set({ session: id }, history);
}

function moveSelection(delta: number) {
  const cards = [...list.querySelectorAll<HTMLButtonElement>(".session-card")];
  if (!cards.length) return;
  const current = cards.findIndex((card) => card.dataset.id === store.get().session);
  const next = cards[current === -1 ? 0 : Math.max(0, Math.min(cards.length - 1, current + delta))]!;
  next.focus();
  next.scrollIntoView({ block: "nearest" });
  selectSession(next.dataset.id!, "replace");
}

function markSelected(id: string | null) {
  for (const card of list.querySelectorAll<HTMLElement>(".session-card")) {
    if (card.dataset.id === id) card.setAttribute("aria-current", "true");
    else card.removeAttribute("aria-current");
  }
}

// ── detail ──────────────────────────────────────────────────────────────
function renderDetailEmpty() {
  replace(
    detailPane,
    EmptyState({
      icon: "clock",
      title: "Escolha uma sessão",
      text: h("p", null, "Use ", Kbd("↓"), " ", Kbd("↑"), " para navegar. Com uma sessão aberta, ", Kbd("o"), " retoma no Terminal e ", Kbd("h"), " copia o handoff. ", Kbd("?"), " mostra todos os atalhos."),
    }),
  );
}

async function loadDetail(id: string | null) {
  if (!id) {
    detail = null;
    main.removeAttribute("data-detail-open");
    renderDetailEmpty();
    return;
  }
  main.dataset.detailOpen = "";
  try {
    const data = await api.session(id, showReplies);
    if (store.get().session !== id) return;
    detail = data;
    replace(
      detailPane,
      SessionDetail({
        data,
        showReplies,
        canOpenTerminal,
        rawUrl: api.rawUrl,
        onRestore: (fileId) => api.restore(fileId),
        onBack: () => store.set({ session: null }, "push"),
        onToggleReplies: () => {
          showReplies = !showReplies;
          void loadDetail(id);
        },
        onOpenTerminal: (button) => void openTerminal(button),
        onCopyCommand: () => void copyCommand(),
        onCopyHandoff: (button) => void copyHandoff(button),
      }),
    );
    detailPane.scrollTop = 0;
  } catch (error) {
    replace(detailPane, EmptyState({ icon: "alert", title: "Sessão indisponível", text: (error as Error).message }));
  }
}

async function copy(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message, "success");
  } catch {
    toast("O navegador bloqueou a área de transferência.", "danger");
  }
}

async function copyCommand() {
  if (!detail?.session.resumeCommand) return toast("Esta sessão só tem os prompts; use o handoff.", "neutral");
  await copy(detail.session.resumeCommand, "Comando copiado. Cole num terminal.");
}

async function copyHandoff(button?: HTMLElement) {
  const id = detail?.session.id;
  if (!id) return;
  const run = async () => copy((await api.handoff(id)).text, "Handoff copiado. Cole numa sessão nova do Claude Code.");
  if (button) await whileBusy(button, run);
  else await run();
}

async function openTerminal(button?: HTMLElement) {
  const id = detail?.session.id;
  if (!id || !detail?.session.resumeCommand) return;
  const run = async () => {
    try {
      await api.openTerminal(id);
      toast("Abrindo a sessão no Terminal…", "success");
    } catch (error) {
      toast((error as Error).message, "danger");
    }
  };
  if (button) await whileBusy(button, run);
  else await run();
}

// ── state & shortcuts ───────────────────────────────────────────────────
// Each view reads the search box differently (text vs. path), so switching starts from an empty query.
function setView(view: View) {
  if (store.get().view !== view) store.set({ view, session: null, q: "" }, "push");
}

store.subscribe((state, previous) => {
  searchBar.setValue(state.q);
  searchBar.setPlaceholder(PLACEHOLDERS[state.view]);
  searchBar.input.disabled = state.view === "pending";
  tabs.setActive(state.view);
  main.dataset.view = state.view;
  document.title = state.q ? `${state.q} · lembra` : "lembra";
  filters.update(state, facets);
  if (LIST_KEYS.some((key) => state[key] !== previous[key])) void loadList();
  if (state.session !== previous.session) {
    markSelected(state.session);
    showReplies = false;
    void loadDetail(state.session);
  }
});

window.addEventListener("popstate", () => store.set(fromSearch(location.search), "none"));

const unlessDialog = (action: () => void) => () => {
  if (!help.el.open) action();
};

bindShortcuts(
  {
    "/": unlessDialog(() => searchBar.focus()),
    j: unlessDialog(() => moveSelection(1)),
    k: unlessDialog(() => moveSelection(-1)),
    ArrowDown: unlessDialog(() => moveSelection(1)),
    ArrowUp: unlessDialog(() => moveSelection(-1)),
    o: unlessDialog(() => void openTerminal()),
    c: unlessDialog(() => void copyCommand()),
    h: unlessDialog(() => void copyHandoff()),
    "1": unlessDialog(() => setView("sessions")),
    "2": unlessDialog(() => setView("files")),
    "3": unlessDialog(() => setView("pending")),
    "?": unlessDialog(() => help.open()),
    Escape: (event) => {
      if (help.el.open) return help.close();
      if (event.target === searchBar.input) {
        if (searchBar.input.value) {
          searchBar.setValue("");
          store.set({ q: "" });
        } else searchBar.input.blur();
        return;
      }
      if (store.get().session) store.set({ session: null }, "push");
    },
  },
  ["Escape"],
);

// ── vital signs ─────────────────────────────────────────────────────────
async function refreshMeta() {
  try {
    const [stats, latestFacets] = await Promise.all([api.stats(), api.facets()]);
    status.update(stats);
    facets = latestFacets;
    filters.update(store.get(), facets);
  } catch {
    // The status bar keeps its last values; the list shows its own errors.
  }
}

filters.update(store.get(), facets);
void loadList();
void loadDetail(store.get().session);
void refreshMeta();
setInterval(() => void refreshMeta(), META_EVERY_MS);
