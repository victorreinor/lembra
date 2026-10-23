import { h } from "../../lib/dom";
import { clock, repoHue } from "../../lib/format";
import { t } from "../../lib/i18n";
import { icon } from "../../lib/icons";
import type { ResultDTO } from "../../../types";
import { Badge } from "../badge/badge";
import { Snippet } from "../snippet/snippet";

/**
 * An index card for one session: repo-colored tab, title, metadata and the matching snippets.
 * Example: SessionCard({ result, index: 0, selected: false, onSelect: (id) => … })
 */
export interface SessionCardProps {
  result: ResultDTO;
  index: number;
  selected: boolean;
  onSelect(id: string): void;
}

export function SessionCard({ result, index, selected, onSelect }: SessionCardProps): HTMLElement {
  const { session, snippets } = result;
  const body = snippets.length ? snippets.map(Snippet) : session.lastPrompt && h("span", { class: "session-card__preview" }, session.lastPrompt);

  const button = h(
    "button",
    {
      class: "session-card",
      type: "button",
      "aria-current": selected ? "true" : undefined,
      dataset: { id: session.id, source: session.source },
      style: { "--repo-hue": repoHue(session.repoName), "--i": index },
      onclick: () => onSelect(session.id),
    },
    h("span", { class: "session-card__tab", "aria-hidden": "true" }),
    h(
      "span",
      { class: "session-card__head" },
      h("span", { class: "session-card__title" }, session.title ?? t.sessions.untitled),
      session.digest && Badge(t.card.summary, "accent", "spark"),
      session.source === "history" && Badge(t.card.promptsOnly, "warning"),
    ),
    h(
      "span",
      { class: "session-card__meta" },
      h("span", { class: "session-card__id" }, session.id.slice(0, 8)),
      h("span", null, clock(session.endedAt)),
      h("span", { class: "session-card__repo" }, session.repoName),
      session.branch && h("span", { class: "session-card__branch" }, icon("branch", 12), session.branch),
      h("span", null, t.detail.prompts(session.promptCount)),
    ),
    body && h("span", { class: "session-card__body" }, body),
  );
  return h("li", { class: "session-card__item" }, button);
}
