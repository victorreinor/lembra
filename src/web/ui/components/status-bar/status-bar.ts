import { h, replace } from "../../lib/dom";
import { ago, monthYear } from "../../lib/format";
import { locale, t } from "../../lib/i18n";
import type { StatsResponse } from "../../../types";
import { Button } from "../button/button";

/**
 * Footer with the vault's vital signs, the language and theme switches, and help.
 * Example: StatusBar({ onToggleTheme, onSwitchLanguage, onHelp }).update(stats)
 */
export function StatusBar(props: { onToggleTheme(): void; onSwitchLanguage(): void; onHelp(): void }) {
  const text = h("p", { class: "status-bar__text" }, t.status.loading);
  const el = h(
    "footer",
    { class: "status-bar" },
    text,
    h(
      "span",
      { class: "status-bar__actions" },
      h("button", { class: "status-bar__lang", type: "button", title: t.status.language, onclick: () => props.onSwitchLanguage() }, locale === "pt-BR" ? "PT" : "EN"),
      Button({ label: t.status.theme, icon: "moon", variant: "ghost", size: "sm", iconOnly: true, onClick: () => props.onToggleTheme() }),
      Button({ label: t.status.help, icon: "keyboard", variant: "ghost", size: "sm", iconOnly: true, onClick: () => props.onHelp() }),
    ),
  );

  function update(stats: StatsResponse) {
    replace(
      text,
      h("span", null, t.status.sessions(stats.sessions + stats.historyOnly)),
      stats.oldest && h("span", null, t.status.since(monthYear(stats.oldest))),
      h("span", null, t.status.recoverable(stats.missing)),
      h("span", null, t.status.indexed(ago(stats.indexedAt))),
      stats.retentionDays ? h("span", null, t.status.retention(stats.retentionDays)) : h("span", { class: "status-bar__warning" }, t.status.retentionWarning),
      h("span", { class: "status-bar__version" }, `v${stats.version}`),
    );
  }

  return { el, update };
}
