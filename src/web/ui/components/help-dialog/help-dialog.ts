import { h } from "../../lib/dom";
import { t } from "../../lib/i18n";
import { Button } from "../button/button";
import { Kbd } from "../kbd/kbd";

/** Shortcut and search-syntax reference. Example: const help = HelpDialog(); help.open() */
export function HelpDialog() {
  const s = t.help.shortcuts;
  const shortcuts: [string[], string][] = [
    [["/"], s.search],
    [["↓", "↑"], s.move],
    [["Enter"], s.open],
    [["o"], s.terminal],
    [["c"], s.command],
    [["h"], s.handoff],
    [["1", "2", "3"], s.views],
    [["Esc"], s.escape],
    [["?"], s.help],
  ];
  const tips = Object.values(t.help.tips);

  const dialog = h(
    "dialog",
    { class: "help-dialog", "aria-labelledby": "help-title" },
    h(
      "div",
      { class: "help-dialog__head" },
      h("h2", { id: "help-title", class: "help-dialog__title" }, t.help.title),
      Button({ label: t.help.close, icon: "close", iconOnly: true, onClick: () => void dialog.close() }),
    ),
    h("dl", { class: "help-dialog__list" }, shortcuts.map(([keys, action]) => [h("dt", null, keys.map((key) => Kbd(key))), h("dd", null, action)])),
    h("h3", { class: "label" }, t.help.searchTitle),
    h("dl", { class: "help-dialog__list" }, tips.map(([example, tip]) => [h("dt", null, h("code", null, example)), h("dd", null, tip)])),
    h("p", { class: "help-dialog__foot" }, t.help.foot),
  );
  // Clicking the backdrop closes it.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  return { el: dialog, open: () => dialog.showModal(), close: () => dialog.close() };
}
