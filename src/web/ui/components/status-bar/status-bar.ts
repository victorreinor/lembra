import { h, replace } from "../../lib/dom";
import { ago, count } from "../../lib/format";
import type { StatsResponse } from "../../../types";
import { Button } from "../button/button";

/**
 * Footer with the vault's vital signs, the theme switch and help.
 * Example: StatusBar({ onToggleTheme, onHelp }).update(stats)
 */
export function StatusBar(props: { onToggleTheme(): void; onHelp(): void }) {
  const text = h("p", { class: "status-bar__text" }, "carregando…");
  const el = h(
    "footer",
    { class: "status-bar" },
    text,
    h(
      "span",
      { class: "status-bar__actions" },
      Button({ label: "Alternar tema claro/escuro", icon: "moon", variant: "ghost", size: "sm", iconOnly: true, onClick: () => props.onToggleTheme() }),
      Button({ label: "Atalhos e busca (?)", icon: "keyboard", variant: "ghost", size: "sm", iconOnly: true, onClick: () => props.onHelp() }),
    ),
  );

  function update(stats: StatsResponse) {
    const since = stats.oldest ? new Date(stats.oldest).toLocaleDateString("pt-BR", { month: "short", year: "numeric" }) : null;
    replace(
      text,
      h("span", null, count(stats.sessions + stats.historyOnly, "sessão", "sessões")),
      since && h("span", null, `desde ${since}`),
      h("span", null, count(stats.missing, "arquivo recuperável", "arquivos recuperáveis")),
      h("span", null, `indexado ${ago(stats.indexedAt)}`),
      stats.retentionDays
        ? h("span", null, `retenção ${count(stats.retentionDays, "dia", "dias")}`)
        : h("span", { class: "status-bar__warning" }, "o Claude Code ainda apaga transcripts com 30 dias: rode lembra install"),
      h("span", { class: "status-bar__version" }, `v${stats.version}`),
    );
  }

  return { el, update };
}
