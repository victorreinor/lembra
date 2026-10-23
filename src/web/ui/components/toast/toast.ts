import { h } from "../../lib/dom";

const VISIBLE_MS = 2800;
const LEAVE_MS = 260;
let region: HTMLElement | null = null;

/** Short, non-blocking feedback announced to screen readers. Example: toast("Copiado", "success") */
export function toast(message: string, tone: "neutral" | "success" | "danger" = "neutral") {
  region ??= document.body.appendChild(h("div", { class: "toast-region", role: "status", "aria-live": "polite" }));
  const item = region.appendChild(h("div", { class: "toast", dataset: { tone } }, message));
  setTimeout(() => {
    item.dataset.leaving = "";
    setTimeout(() => item.remove(), LEAVE_MS);
  }, VISIBLE_MS);
}
