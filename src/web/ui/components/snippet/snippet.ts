import { h, highlighted } from "../../lib/dom";
import type { SnippetDTO } from "../../../types";

export const ROLE_LABEL = { prompt: "você", reply: "claude", summary: "/compact", digest: "resumo" } as const;

/** One search match, with the matched words marked. Example: Snippet({ role: "prompt", ts, text }) */
export function Snippet(snippet: SnippetDTO): HTMLElement {
  return h(
    "span",
    { class: "snippet", dataset: { role: snippet.role } },
    h("span", { class: "snippet__who" }, ROLE_LABEL[snippet.role]),
    h("span", { class: "snippet__text" }, highlighted(snippet.text)),
  );
}
