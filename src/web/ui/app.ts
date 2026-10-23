import type { FacetsResponse, SearchResponse, SessionDetailResponse } from "../types";
import { Button } from "./components/button/button";
import { DayDivider } from "./components/day-divider/day-divider";
import { EmptyState } from "./components/empty-state/empty-state";
import { FileRow } from "./components/file-row/file-row";
import { FilterBar } from "./components/filter-bar/filter-bar";
import { HelpDialog } from "./components/help-dialog/help-dialog";
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
import { dayKey, dayStamp } from "./lib/format";
import { initLocale, switchLocale, t, withKeys } from "./lib/i18n";
import { bindShortcuts } from "./lib/keyboard";
import { CLEARED_FILTERS, createStore, fromSearch, hasActiveFilters, VIEWS, type State, type View } from "./lib/state";

// The language set with `lembra lang` is the default when the visitor has not picked one here.
initLocale((await api.health().catch(() => null))?.lang);

const SEARCH_DEBOUNCE_MS = 160;
const META_EVERY_MS = 30_000;
const THEME_KEY = "lembra:theme";
const LIST_KEYS: (keyof State)[] = ["view", "q", "repo", "branch", "since", "prompts", "missing"];
// Opening Terminal.app is a macOS feature of the local server.
const canOpenTerminal = /Mac/.test(navigator.userAgent);

const store = createStore(fromSearch(location.search));
let facets: FacetsResponse = { repos: [], branches: [] };
let detail: SessionDetailResponse | null = null;
let showReplies = false;
let firstLoad = true;
let listRequest: AbortController | null = null;
let detailRequest: AbortController | null = null;
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
  placeholder: t.placeholders[store.get().view],
  onInput: (q) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => store.set({ q }), SEARCH_DEBOUNCE_MS);
  },
  onArrowDown: () => moveSelection(1),
});
const tabs = Tabs<View>({
  items: [
    { id: "sessions", label: t.views.sessions, key: "1" },
    { id: "files", label: t.views.files, key: "2" },
    { id: "pending", label: t.views.pending, key: "3" },
  ],
  active: store.get().view,
  onChange: (view) => setView(view),
});
const filters = FilterBar({ onChange: (patch) => store.set(patch) });
const help = HelpDialog();
const status = StatusBar({ onToggleTheme: toggleTheme, onSwitchLanguage: switchLocale, onHelp: help.open });
const listHeader = h("div", { class: "list-header" });
const list = h("ol", { class: "results", "aria-label": t.resultsLabel });
const detailPane = h("section", { class: "detail-pane", "aria-label": t.detailLabel, tabindex: "-1" });
const main = h("main", { class: "app-main", dataset: { view: store.get().view } }, h("section", { class: "list-pane" }, listHeader, list), detailPane);
const header = h(
  "header",
  { class: "app-header" },
  h(
    "a",
    { class: "brand", href: "/", "aria-label": t.brandLabel },
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
  return Button({ label: t.filters.clear, icon: "close", onClick: () => store.set(CLEARED_FILTERS) });
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
      replace(listHeader, h("span", null, t.files.count(response.total, response.files.length)));
      if (!response.files.length) {
        showMessage(EmptyState({ icon: "file", title: t.files.noneTitle, text: t.files.noneText, action: hasActiveFilters(state) ? clearFiltersButton() : undefined }));
      } else {
        replace(list, response.files.map((file) => FileRow({ file, showRepo: true, rawUrl: api.rawUrl, onRestore: (id) => api.restore(id) })));
      }
    } else {
      replace(listHeader, h("span", null, t.pending.checking));
      const response = await api.pending(state.since, request.signal);
      const period = t.filters.periods[response.since as keyof typeof t.filters.periods] ?? response.since;
      replace(listHeader, h("span", null, t.pending.count(response.items.length, period)));
      if (!response.items.length) {
        showMessage(EmptyState({ icon: "branch", tone: "success", title: t.pending.noneTitle, text: t.pending.noneText }));
      } else {
        replace(list, h("li", { class: "results__message" }, PendingList({ items: response.items, onOpenSession: (id) => store.set({ view: "sessions", session: id }, "push") })));
      }
    }
  } catch (error) {
    if ((error as Error).name === "AbortError") return;
    showMessage(EmptyState({ icon: "alert", title: t.load.errorTitle, text: (error as Error).message, action: Button({ label: t.load.retry, onClick: () => void loadList() }) }));
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
    h("span", null, response.mode === "search" ? t.sessions.found(n) : t.sessions.recent(n)),
    response.mode === "search" && h("span", null, t.sessions.tookMs(response.tookMs)),
  );
  if (!n) {
    const searching = response.mode === "search";
    showMessage(
      EmptyState({
        icon: "search",
        title: searching ? t.sessions.noneTitle(state.q) : t.sessions.emptyTitle,
        text: searching ? t.sessions.noneText : t.sessions.emptyText,
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
  replace(detailPane, EmptyState({ icon: "clock", title: t.detail.emptyTitle, text: h("p", null, withKeys(t.detail.emptyText)) }));
}

async function loadDetail(id: string | null) {
  // Moving through the list with j/k abandons the detail of each card passed over.
  detailRequest?.abort();
  if (!id) {
    detail = null;
    main.removeAttribute("data-detail-open");
    renderDetailEmpty();
    return;
  }
  main.dataset.detailOpen = "";
  const request = (detailRequest = new AbortController());
  try {
    const data = await api.session(id, showReplies, request.signal);
    if (store.get().session !== id) return;
    detail = data;
    replace(
      detailPane,
      SessionDetail({
        data,
        showReplies,
        canOpenTerminal,
        rawUrl: api.rawUrl,
        messageUrl: api.messageUrl,
        onRestore: (fileId) => api.restore(fileId),
        onBack: () => store.set({ session: null }, "push"),
        onToggleReplies: () => {
          showReplies = !showReplies;
          void loadDetail(id);
        },
        onOpenTerminal: openTerminal,
        onCopyCommand: () => void copyCommand(),
        onCopyHandoff: copyHandoff,
      }),
    );
    detailPane.scrollTop = 0;
  } catch (error) {
    if ((error as Error).name === "AbortError") return;
    replace(detailPane, EmptyState({ icon: "alert", title: t.detail.unavailable, text: (error as Error).message }));
  }
}

async function copy(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message, "success");
  } catch {
    toast(t.toasts.clipboardBlocked, "danger");
  }
}

async function copyCommand() {
  if (!detail?.session.resumeCommand) return toast(t.toasts.promptsOnly, "neutral");
  await copy(detail.session.resumeCommand, t.toasts.commandCopied);
}

async function copyHandoff() {
  const id = detail?.session.id;
  if (id) await copy((await api.handoff(id)).text, t.toasts.handoffCopied);
}

async function openTerminal() {
  const id = detail?.session.id;
  if (!id || !detail?.session.resumeCommand) return;
  try {
    await api.openTerminal(id);
    toast(t.toasts.openingTerminal, "success");
  } catch (error) {
    toast((error as Error).message, "danger");
  }
}

// ── state & shortcuts ───────────────────────────────────────────────────
// Each view reads the search box differently (text vs. path), so switching starts from an empty query.
function setView(view: View) {
  if (store.get().view !== view) store.set({ view, session: null, q: "" }, "push");
}

store.subscribe((state, previous) => {
  searchBar.setValue(state.q);
  searchBar.setPlaceholder(t.placeholders[state.view]);
  searchBar.input.disabled = !VIEWS[state.view].searchable;
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
// A hidden tab skips the poll and catches up as soon as it is shown again.
setInterval(() => {
  if (!document.hidden) void refreshMeta();
}, META_EVERY_MS);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void refreshMeta();
});
