import { h, highlighted } from "../../lib/dom";
import { t } from "../../lib/i18n";
import type { SnippetDTO } from "../../../types";

/** One search match, with the matched words marked. Example: Snippet({ role: "prompt", ts, text }) */
export function Snippet(snippet: SnippetDTO): HTMLElement {
  return h(
    "span",
    { class: "snippet", dataset: { role: snippet.role } },
    h("span", { class: "snippet__who" }, t.roles[snippet.role]),
    h("span", { class: "snippet__text" }, highlighted(snippet.text)),
  );
}
