import { h, type Child } from "../../lib/dom";
import { icon, type IconName } from "../../lib/icons";

/**
 * Explains why there is nothing to show and what to do next.
 * Example: EmptyState({ icon: "search", title: "Nada encontrado", text: "Tente menos palavras." })
 */
export interface EmptyStateProps {
  icon: IconName;
  title: string;
  text?: Child;
  action?: HTMLElement;
  tone?: "neutral" | "success";
}

export function EmptyState(props: EmptyStateProps): HTMLElement {
  return h(
    "div",
    { class: "empty-state", dataset: { tone: props.tone ?? "neutral" } },
    h("span", { class: "empty-state__icon" }, icon(props.icon, 22)),
    h("p", { class: "empty-state__title" }, props.title),
    props.text && h("div", { class: "empty-state__text" }, props.text),
    props.action,
  );
}
