import { h } from "../../lib/dom";
import { Button } from "../button/button";
import { Kbd } from "../kbd/kbd";

const SHORTCUTS: [string[], string][] = [
  [["/"], "buscar"],
  [["↓", "↑"], "navegar nos resultados (ou j e k)"],
  [["Enter"], "abrir a sessão"],
  [["o"], "retomar no Terminal"],
  [["c"], "copiar o comando de resume"],
  [["h"], "copiar o handoff"],
  [["1", "2", "3"], "sessões, arquivos, pendências"],
  [["Esc"], "limpar a busca ou fechar"],
  [["?"], "esta ajuda"],
];

const TIPS: [string, string][] = [
  ["fatur", "palavras casam como prefixo: acha faturamento"],
  ['"relatório mensal"', "aspas buscam a frase exata"],
  ["relatorio", "acentos e maiúsculas não importam"],
];

/** Shortcut and search-syntax reference. Example: const help = HelpDialog(); help.open() */
export function HelpDialog() {
  const dialog = h(
    "dialog",
    { class: "help-dialog", "aria-labelledby": "help-title" },
    h(
      "div",
      { class: "help-dialog__head" },
      h("h2", { id: "help-title", class: "help-dialog__title" }, "Atalhos e busca"),
      Button({ label: "Fechar", icon: "close", variant: "ghost", size: "sm", iconOnly: true, onClick: () => dialog.close() }),
    ),
    h(
      "dl",
      { class: "help-dialog__list" },
      SHORTCUTS.map(([keys, action]) => [h("dt", null, keys.map((key) => Kbd(key))), h("dd", null, action)]),
    ),
    h("h3", { class: "label" }, "Busca"),
    h(
      "dl",
      { class: "help-dialog__list" },
      TIPS.map(([example, tip]) => [h("dt", null, h("code", null, example)), h("dd", null, tip)]),
    ),
    h("p", { class: "help-dialog__foot" }, "A busca cobre seus prompts, as respostas do Claude, os resumos do /compact e os títulos das sessões."),
  );
  // Clicking the backdrop closes it.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  return { el: dialog, open: () => dialog.showModal(), close: () => dialog.close() };
}
