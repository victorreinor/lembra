import { h } from "../../lib/dom";
import { ago, repoHue } from "../../lib/format";
import { t } from "../../lib/i18n";
import { icon } from "../../lib/icons";
import type { PendingDTO } from "../../../types";
import { Badge } from "../badge/badge";

/**
 * Branches whose work is not delivered yet, each linking to its latest session.
 * Example: PendingList({ items, onOpenSession: (id) => … })
 */
export function PendingList({ items, onOpenSession }: { items: PendingDTO[]; onOpenSession(id: string): void }): HTMLElement {
  return h(
    "ul",
    { class: "pending-list" },
    items.map((item, index) =>
      h(
        "li",
        { class: "pending-item", style: { "--repo-hue": repoHue(item.repoName), "--i": index } },
        h(
          "div",
          { class: "pending-item__where" },
          h("span", { class: "pending-item__repo" }, item.repoName),
          h("span", { class: "pending-item__branch" }, icon("branch", 13), item.branch),
        ),
        h("div", { class: "pending-item__reasons" }, item.reasons.map((reason) => Badge(reason, "warning", "alert"))),
        h(
          "button",
          { class: "pending-item__session", type: "button", onclick: () => onOpenSession(item.lastSession.id) },
          h("span", { class: "pending-item__title" }, item.lastSession.title),
          h("span", { class: "pending-item__when" }, `${ago(item.lastSession.endedAt)} · ${t.pending.sessions(item.sessions)}`),
        ),
      ),
    ),
  );
}
