import { h } from "../../lib/dom";
import { icon, type IconName } from "../../lib/icons";

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";

/** Short status label. Example: Badge("apagado do disco", "danger") */
export function Badge(text: string, tone: BadgeTone = "neutral", iconName?: IconName): HTMLElement {
  return h("span", { class: "badge", dataset: { tone } }, iconName && icon(iconName, 12), text);
}
