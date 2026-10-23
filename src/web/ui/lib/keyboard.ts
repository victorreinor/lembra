// Global shortcuts. Single keys are ignored while typing, except the ones listed in `whileTyping`.

export type Shortcuts = Record<string, (event: KeyboardEvent) => void>;

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

export function bindShortcuts(shortcuts: Shortcuts, whileTyping: string[] = ["Escape"]) {
  const onKey = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTyping(event.target) && !whileTyping.includes(event.key)) return;
    const action = shortcuts[event.key];
    if (!action) return;
    event.preventDefault();
    action(event);
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
