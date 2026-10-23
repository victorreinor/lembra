export type Child = Node | string | number | false | null | undefined | Child[];

type Props = {
  class?: string | false | null;
  dataset?: Record<string, string | undefined>;
  // CSS properties, including custom properties such as "--repo-hue".
  style?: Record<string, string | number | undefined>;
  [attribute: string]: unknown;
};

// Builds elements from text nodes and attributes only, so transcript content can never become markup.
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") element.className = String(value);
    else if (key === "dataset") {
      for (const [name, data] of Object.entries(value as Record<string, string | undefined>)) if (data !== undefined) element.dataset[name] = data;
    } else if (key === "style") {
      for (const [name, css] of Object.entries(value as Record<string, string | number | undefined>)) if (css !== undefined) element.style.setProperty(name, String(css));
    } else if (key.startsWith("on") && typeof value === "function") {
      element.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else {
      element.setAttribute(key, value === true ? "" : String(value));
    }
  }
  append(element, children);
  return element;
}

export function append(parent: Node, children: Child[]) {
  for (const child of children.flat(Infinity as 1) as Child[]) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function replace(parent: Element, ...children: Child[]) {
  parent.replaceChildren();
  append(parent, children);
}

// Turns the \x01…\x02 markers of a search snippet into <mark> elements.
export function highlighted(text: string): Child[] {
  return text.split(/(\x01[^\x02]*\x02)/).map((part) => (part.startsWith("\x01") ? h("mark", null, part.slice(1, -1)) : part));
}
