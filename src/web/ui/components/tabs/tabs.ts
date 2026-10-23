import { h } from "../../lib/dom";

/**
 * Segmented view switcher. Example:
 * Tabs({ items: [{ id: "sessions", label: "Sessões", key: "1" }], active: "sessions", onChange })
 */
export interface TabItem<T extends string> {
  id: T;
  label: string;
  key: string;
}

export function Tabs<T extends string>(props: { items: TabItem<T>[]; active: T; onChange(id: T): void }) {
  const buttons = new Map<T, HTMLButtonElement>();
  const el = h(
    "div",
    { class: "tabs", role: "tablist", "aria-label": "Visões" },
    props.items.map((item) => {
      const button = h(
        "button",
        { class: "tabs__tab", type: "button", role: "tab", title: `${item.label} (${item.key})`, onclick: () => props.onChange(item.id) },
        item.label,
      );
      buttons.set(item.id, button);
      return button;
    }),
  );
  const setActive = (active: T) => {
    for (const [id, button] of buttons) button.setAttribute("aria-selected", String(id === active));
  };
  setActive(props.active);
  return { el, setActive };
}
