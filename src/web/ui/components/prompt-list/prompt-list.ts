import { h } from "../../lib/dom";
import { clock } from "../../lib/format";
import type { MessageDTO } from "../../../types";

const LONG_CHARS = 700;
const LONG_LINES = 10;

/**
 * The conversation of a session: numbered prompts, /compact summaries (collapsed) and, optionally, replies.
 * Example: PromptList({ messages })
 */
export function PromptList({ messages }: { messages: MessageDTO[] }): HTMLElement {
  let number = 0;
  return h(
    "ol",
    { class: "prompt-list" },
    messages.map((message) => {
      if (message.role === "summary") {
        return h(
          "li",
          { class: "prompt-list__item", dataset: { role: "summary" } },
          h(
            "details",
            { class: "prompt-list__summary" },
            h("summary", null, h("span", { class: "label" }, "resumo do /compact"), h("time", { datetime: message.ts }, clock(message.ts))),
            h("div", { class: "prompt-list__text" }, message.text),
          ),
        );
      }
      const gutter = message.role === "prompt" ? String(++number).padStart(2, "0") : "↳";
      return h(
        "li",
        { class: "prompt-list__item", dataset: { role: message.role } },
        h("span", { class: "prompt-list__gutter", "aria-hidden": "true" }, gutter),
        h(
          "div",
          { class: "prompt-list__content" },
          h("span", { class: "prompt-list__meta" }, message.role === "reply" ? "claude · " : "", h("time", { datetime: message.ts }, clock(message.ts))),
          Collapsible(message.text),
        ),
      );
    }),
  );
}

function Collapsible(text: string): HTMLElement {
  const long = text.length > LONG_CHARS || text.split("\n").length > LONG_LINES;
  const body = h("div", { class: "prompt-list__text", dataset: { collapsed: long ? "" : undefined } }, text);
  if (!long) return body;
  const toggle = h("button", { class: "prompt-list__more", type: "button", "aria-expanded": "false" }, "ver tudo");
  toggle.addEventListener("click", () => {
    const expanded = body.toggleAttribute("data-collapsed") === false;
    toggle.textContent = expanded ? "recolher" : "ver tudo";
    toggle.setAttribute("aria-expanded", String(expanded));
  });
  return h("div", null, body, toggle);
}
