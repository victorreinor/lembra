import { h } from "../../lib/dom";
import { icon, type IconName } from "../../lib/icons";
import { Kbd } from "../kbd/kbd";

/**
 * Button or link styled as a button. An async onClick marks it busy until it settles.
 * Example: Button({ label: "Copiar comando", icon: "copy", shortcut: "c", onClick })
 */
export interface ButtonProps {
  label: string;
  icon?: IconName;
  // Default: secondary and md; ghost and sm when iconOnly.
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  iconOnly?: boolean;
  shortcut?: string;
  onClick?: (event: MouseEvent) => unknown;
  // Renders an <a> instead of a <button>.
  href?: string;
  download?: boolean;
  newTab?: boolean;
}

export function Button(props: ButtonProps): HTMLElement {
  const size = props.size ?? (props.iconOnly ? "sm" : "md");
  const content = [
    props.icon && icon(props.icon, size === "sm" ? 14 : 16),
    h("span", { class: props.iconOnly ? "visually-hidden" : "button__label" }, props.label),
    props.shortcut && !props.iconOnly && Kbd(props.shortcut),
  ];
  const attributes = {
    class: "button",
    title: props.iconOnly ? props.label : undefined,
    dataset: { variant: props.variant ?? (props.iconOnly ? "ghost" : "secondary"), size, iconOnly: props.iconOnly ? "" : undefined },
  };
  if (props.href) {
    return h(
      "a",
      { ...attributes, href: props.href, download: props.download, target: props.newTab ? "_blank" : undefined, rel: props.newTab ? "noopener" : undefined },
      content,
    );
  }
  const onClick = props.onClick;
  const button = h("button", { ...attributes, type: "button" }, content);
  if (onClick) {
    button.addEventListener("click", (event) => {
      // Repeated clicks are ignored while an action is still running.
      if (button.getAttribute("aria-busy") === "true") return;
      const result = onClick(event);
      if (!(result instanceof Promise)) return;
      button.setAttribute("aria-busy", "true");
      void result.finally(() => button.removeAttribute("aria-busy"));
    });
  }
  return button;
}
