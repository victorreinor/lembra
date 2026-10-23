import { h } from "../../lib/dom";

/** Date stamp between result groups. Example: DayDivider("ONTEM") */
export function DayDivider(stamp: string): HTMLElement {
  return h("li", { class: "day-divider", role: "presentation" }, h("span", { class: "day-divider__stamp" }, stamp));
}
