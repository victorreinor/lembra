import { h } from "../../lib/dom";
import { clock, count, fullDate, repoHue } from "../../lib/format";
import { icon } from "../../lib/icons";
import type { SessionDetailResponse } from "../../../types";
import { Badge } from "../badge/badge";
import { Button } from "../button/button";
import { FileRow, type FileRowProps } from "../file-row/file-row";
import { PromptList } from "../prompt-list/prompt-list";

/**
 * Everything about one session and the ways to continue it.
 * Example: SessionDetail({ data, showReplies: false, canOpenTerminal: true, …callbacks })
 */
export interface SessionDetailProps extends Pick<FileRowProps, "rawUrl" | "onRestore"> {
  data: SessionDetailResponse;
  showReplies: boolean;
  canOpenTerminal: boolean;
  onBack(): void;
  onToggleReplies(): void;
  onOpenTerminal(button: HTMLElement): void;
  onCopyCommand(): void;
  onCopyHandoff(button: HTMLElement): void;
}

export function SessionDetail(props: SessionDetailProps): HTMLElement {
  const { session, messages, files } = props.data;
  const prompts = messages.filter((message) => message.role === "prompt").length;
  const facts = [
    `${fullDate(session.startedAt)} → ${clock(session.endedAt)}`,
    count(prompts || session.promptCount, "prompt", "prompts"),
    session.costUsd ? `US$ ${session.costUsd.toFixed(2)}` : null,
    session.linesAdded !== null ? `+${session.linesAdded} −${session.linesRemoved ?? 0} linhas` : null,
  ].filter(Boolean);

  const actions =
    session.source === "transcript"
      ? [
          props.canOpenTerminal &&
            Button({ label: "Retomar no Terminal", icon: "terminal", variant: "primary", shortcut: "o", onClick: (e) => props.onOpenTerminal(e.currentTarget as HTMLElement) }),
          Button({ label: "Copiar comando", icon: "copy", shortcut: "c", onClick: () => props.onCopyCommand() }),
          Button({ label: "Copiar handoff", icon: "handoff", shortcut: "h", onClick: (e) => props.onCopyHandoff(e.currentTarget as HTMLElement) }),
        ]
      : [
          Button({ label: "Copiar handoff", icon: "handoff", variant: "primary", shortcut: "h", onClick: (e) => props.onCopyHandoff(e.currentTarget as HTMLElement) }),
        ];

  return h(
    "article",
    { class: "session-detail", style: { "--repo-hue": repoHue(session.repoName) }, "aria-labelledby": "session-title" },
    h(
      "header",
      { class: "session-detail__header" },
      h("span", { class: "session-detail__back" }, Button({ label: "Voltar", icon: "back", variant: "ghost", size: "sm", onClick: () => props.onBack() })),
      h(
        "p",
        { class: "session-detail__eyebrow" },
        h("span", { class: "session-detail__repo" }, session.repoName),
        session.branch && h("span", { class: "session-detail__branch" }, icon("branch", 12), session.branch),
        h("span", { class: "session-detail__id" }, session.id.slice(0, 8)),
      ),
      h("h2", { id: "session-title", class: "session-detail__title" }, session.title),
      h("p", { class: "session-detail__facts" }, facts.join(" · ")),
      session.cwd && h("p", { class: "session-detail__path" }, icon("folder", 13), session.cwd),
    ),
    h("div", { class: "session-detail__actions" }, actions),
    session.resumeCommand
      ? h("code", { class: "session-detail__command" }, session.resumeCommand)
      : h(
          "p",
          { class: "session-detail__notice" },
          Badge("só prompts", "warning"),
          "O Claude Code apagou o transcript antes do lembra existir. Dá para levar o contexto com o handoff.",
        ),
    session.digest &&
      h("section", { class: "session-detail__digest" }, h("span", { class: "label" }, icon("spark", 12), "resumo"), h("p", null, session.digest)),
    h(
      "section",
      { class: "session-detail__section" },
      h(
        "div",
        { class: "session-detail__section-head" },
        h("h3", { class: "label" }, "Conversa"),
        session.source === "transcript" &&
          Button({
            label: props.showReplies ? "ocultar respostas do Claude" : "mostrar respostas do Claude",
            variant: "ghost",
            size: "sm",
            onClick: () => props.onToggleReplies(),
          }),
      ),
      PromptList({ messages }),
    ),
    files.length > 0 &&
      h(
        "section",
        { class: "session-detail__section" },
        h("div", { class: "session-detail__section-head" }, h("h3", { class: "label" }, `Arquivos · ${files.length}`)),
        h("ul", { class: "file-list" }, files.map((file) => FileRow({ file, rawUrl: props.rawUrl, onRestore: props.onRestore }))),
      ),
  );
}
