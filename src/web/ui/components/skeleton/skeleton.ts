import { h } from "../../lib/dom";

/** Placeholder cards shown while the first results load. Example: Skeleton(6) */
export function Skeleton(count: number): HTMLElement[] {
  return Array.from({ length: count }, () =>
    h(
      "li",
      { class: "skeleton", "aria-hidden": "true" },
      h("span", { class: "skeleton__line", dataset: { width: "title" } }),
      h("span", { class: "skeleton__line", dataset: { width: "meta" } }),
      h("span", { class: "skeleton__line", dataset: { width: "body" } }),
    ),
  );
}
