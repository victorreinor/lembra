// App state lives in the URL, so back/forward work and any view can be bookmarked or shared.

export type View = "sessions" | "files" | "pending";

export interface State {
  view: View;
  q: string;
  repo: string;
  branch: string;
  // "", "1d", "7d", "30d", "90d"
  since: string;
  prompts: boolean;
  missing: boolean;
  session: string | null;
}

export const DEFAULT_STATE: State = { view: "sessions", q: "", repo: "", branch: "", since: "", prompts: false, missing: false, session: null };

const VIEWS: View[] = ["sessions", "files", "pending"];

// Filters each view offers; the others stay in the URL but are ignored (and hidden) there.
export const VIEW_FILTERS: Record<View, (keyof State)[]> = {
  sessions: ["repo", "branch", "since", "prompts"],
  files: ["repo", "since", "missing"],
  pending: ["since"],
};

export const CLEARED_FILTERS: Partial<State> = { repo: "", branch: "", since: "", prompts: false, missing: false };

export function hasActiveFilters(state: State): boolean {
  return VIEW_FILTERS[state.view].some((key) => Boolean(state[key]));
}

export function fromSearch(search: string): State {
  const params = new URLSearchParams(search);
  const view = params.get("view") as View | null;
  return {
    view: view && VIEWS.includes(view) ? view : "sessions",
    q: params.get("q") ?? "",
    repo: params.get("repo") ?? "",
    branch: params.get("branch") ?? "",
    since: params.get("since") ?? "",
    prompts: params.get("prompts") === "1",
    missing: params.get("missing") === "1",
    session: params.get("s"),
  };
}

export function toSearch(state: State): string {
  const params = new URLSearchParams();
  if (state.view !== "sessions") params.set("view", state.view);
  if (state.q) params.set("q", state.q);
  if (state.repo) params.set("repo", state.repo);
  if (state.branch) params.set("branch", state.branch);
  if (state.since) params.set("since", state.since);
  if (state.prompts) params.set("prompts", "1");
  if (state.missing) params.set("missing", "1");
  if (state.session) params.set("s", state.session);
  const text = params.toString();
  return text ? `?${text}` : "";
}

export type Listener = (state: State, previous: State) => void;

export function createStore(initial: State) {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => state,
    // `history: "push"` adds an entry (selecting a session, switching views); typing replaces it.
    set(patch: Partial<State>, history: "push" | "replace" | "none" = "replace") {
      const previous = state;
      state = { ...state, ...patch };
      if (history !== "none") {
        const url = `${location.pathname}${toSearch(state)}`;
        if (history === "push") window.history.pushState(null, "", url);
        else window.history.replaceState(null, "", url);
      }
      for (const listener of listeners) listener(state, previous);
    },
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type Store = ReturnType<typeof createStore>;
