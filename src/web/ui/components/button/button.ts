import { h } from "../../lib/dom";
import { icon, type IconName } from "../../lib/icons";
import { Kbd } from "../kbd/kbd";

/**
 * Button or link styled as a button.
 * Example: Button({ label: "Copiar comando", icon: "copy", shortcut: "c", onClick })
 */
export interface ButtonProps {
  label: string;
  icon?: IconName;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  iconOnly?: boolean;
  shortcut?: string;
  title?: string;
  onClick?: (event: MouseEvent) => void;
  // Renders an <a> instead of a <button>.
  href?: string;
  download?: boolean;
  newTab?: boolean;
}

export function Button(props: ButtonProps): HTMLElement {
  const content = [
    props.icon && icon(props.icon, props.size === "sm" ? 14 : 16),
    h("span", { class: props.iconOnly ? "visually-hidden" : "button__label" }, props.label),
    props.shortcut && !props.iconOnly && Kbd(props.shortcut),
  ];
  const attributes = {
    class: "button",
    title: props.title ?? (props.iconOnly ? props.label : undefined),
    dataset: { variant: props.variant ?? "secondary", size: props.size ?? "md", iconOnly: props.iconOnly ? "" : undefined },
  };
  if (props.href) {
    return h(
      "a",
      { ...attributes, href: props.href, download: props.download, target: props.newTab ? "_blank" : undefined, rel: props.newTab ? "noopener" : undefined },
      content,
    );
  }
  return h("button", { ...attributes, type: "button", onclick: props.onClick }, content);
}

// Marks the button busy while the action runs and ignores repeated clicks meanwhile.
export async function whileBusy(button: HTMLElement, action: () => Promise<void>) {
  if (button.getAttribute("aria-busy") === "true") return;
  button.setAttribute("aria-busy", "true");
  try {
    await action();
  } finally {
    button.removeAttribute("aria-busy");
  }
}
