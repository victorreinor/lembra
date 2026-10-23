import { h } from "../../lib/dom";
import { icon } from "../../lib/icons";
import { t } from "../../lib/i18n";
import { Kbd } from "../kbd/kbd";

/**
 * The main search field. Accepts the CLI syntax: prefixes and "exact phrases".
 * Example: SearchBar({ value: "", placeholder: "Buscar…", onInput: (q) => store.set({ q }) })
 */
export interface SearchBarProps {
  value: string;
  placeholder: string;
  onInput(value: string): void;
  // ArrowDown from the field moves into the results.
  onArrowDown?(): void;
}

export function SearchBar(props: SearchBarProps) {
  const input = h("input", {
    class: "search-bar__input",
    type: "search",
    name: "q",
    value: props.value,
    placeholder: props.placeholder,
    autocomplete: "off",
    spellcheck: "false",
    "aria-label": t.searchLabel,
  });
  input.addEventListener("input", () => props.onInput(input.value));
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" && props.onArrowDown) {
      event.preventDefault();
      props.onArrowDown();
    }
  });
  const el = h(
    "form",
    { class: "search-bar", role: "search", onsubmit: (event: Event) => event.preventDefault() },
    icon("search", 20),
    input,
    h("span", { class: "search-bar__hint" }, Kbd("/")),
  );
  return {
    el,
    input,
    setValue(value: string) {
      if (input.value !== value) input.value = value;
    },
    setPlaceholder(text: string) {
      input.placeholder = text;
    },
    focus() {
      input.focus();
      input.select();
    },
  };
}
