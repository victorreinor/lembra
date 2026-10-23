import { h } from "../../lib/dom";

/** Keyboard key hint. Example: Kbd("/") */
export function Kbd(keys: string): HTMLElement {
  return h("kbd", { class: "kbd" }, keys);
}
