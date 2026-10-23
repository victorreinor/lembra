import { h, replace } from "../../lib/dom";
import { CLEARED_FILTERS, hasActiveFilters, VIEW_FILTERS, type State, type View } from "../../lib/state";
import type { FacetsResponse } from "../../../types";
import { Button } from "../button/button";

/**
 * Filters offered by the current view (see VIEW_FILTERS): repo, branch, period and a toggle.
 * Example: FilterBar({ onChange: (patch) => store.set(patch) }).update(state, facets)
 */
export const PERIODS: Record<View, { value: string; label: string }[]> = {
  sessions: [
    { value: "", label: "Tudo" },
    { value: "1d", label: "24 h" },
    { value: "7d", label: "7 dias" },
    { value: "30d", label: "30 dias" },
    { value: "90d", label: "90 dias" },
  ],
  files: [
    { value: "", label: "Tudo" },
    { value: "1d", label: "24 h" },
    { value: "7d", label: "7 dias" },
    { value: "30d", label: "30 dias" },
  ],
  // Pending work is computed over recent sessions; "" means the default 14 days.
  pending: [
    { value: "", label: "14 dias" },
    { value: "30d", label: "30 dias" },
    { value: "90d", label: "90 dias" },
  ],
};

type Patch = Partial<Pick<State, "repo" | "branch" | "since" | "prompts" | "missing">>;
type Option = { value: string; label: string };

function Select(label: string, value: string, options: Option[], onChange: (value: string) => void) {
  // Keep a selected value visible even when it is not among the suggestions.
  if (value && !options.some((option) => option.value === value)) options.push({ value, label: value });
  const select = h(
    "select",
    { class: "filter-select__control", "aria-label": label, onchange: (event: Event) => onChange((event.target as HTMLSelectElement).value) },
    options.map((option) => h("option", { value: option.value, selected: option.value === value }, option.label)),
  );
  return h("label", { class: "filter-select", dataset: { active: value ? "" : undefined } }, h("span", { class: "filter-select__label label" }, label), select);
}

function Toggle(label: string, checked: boolean, onChange: (checked: boolean) => void) {
  return h(
    "label",
    { class: "toggle" },
    h("input", { type: "checkbox", class: "toggle__input", checked, onchange: (event: Event) => onChange((event.target as HTMLInputElement).checked) }),
    h("span", { class: "toggle__track", "aria-hidden": "true" }),
    label,
  );
}

export function FilterBar(props: { onChange(patch: Patch): void }) {
  const el = h("div", { class: "filter-bar", role: "group", "aria-label": "Filtros" });

  function update(state: State, facets: FacetsResponse) {
    const offers = new Set(VIEW_FILTERS[state.view]);
    const repos: Option[] = [{ value: "", label: "todos" }, ...facets.repos.map((facet) => ({ value: facet.value, label: facet.value.split("/").pop()! }))];
    const branches: Option[] = [{ value: "", label: "todas" }, ...facets.branches.map((facet) => ({ value: facet.value, label: facet.value }))];
    replace(
      el,
      offers.has("repo") && Select("repo", state.repo, repos, (repo) => props.onChange({ repo, branch: "" })),
      offers.has("branch") && Select("branch", state.branch, branches, (branch) => props.onChange({ branch })),
      h(
        "div",
        { class: "chips", role: "group", "aria-label": "Período" },
        PERIODS[state.view].map((period) =>
          h(
            "button",
            { class: "chip", type: "button", "aria-pressed": String(state.since === period.value), onclick: () => props.onChange({ since: period.value }) },
            period.label,
          ),
        ),
      ),
      offers.has("prompts") && Toggle("só meus prompts", state.prompts, (prompts) => props.onChange({ prompts })),
      offers.has("missing") && Toggle("só apagados do disco", state.missing, (missing) => props.onChange({ missing })),
      hasActiveFilters(state) && Button({ label: "Limpar filtros", variant: "ghost", size: "sm", icon: "close", onClick: () => props.onChange(CLEARED_FILTERS) }),
    );
  }

  return { el, update };
}
