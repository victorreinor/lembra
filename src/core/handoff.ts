import type { Database } from "bun:sqlite";
import { isAbsolute } from "node:path";
import { isMissing, sessionFiles } from "./files";
import { resumeCommand, sessionMessages, type Session } from "./sessions";
import { clip, oneLine, shortPath, when } from "./text";

const RECENT_PROMPTS = 8;

const quote = (text: string) => text.replace(/^/gm, "> ");

// A Markdown brief that lets a fresh Claude session pick up where another one stopped.
export function buildHandoff(db: Database, session: Session): string {
  const messages = sessionMessages(db, session.id, { replies: true });
  const prompts = messages.filter((message) => message.role === "prompt");
  const lastSummary = messages.findLast((message) => message.role === "summary");
  const lastReply = messages.findLast((message) => message.role === "reply");
  const files = sessionFiles(db, session.id).filter((file) => isAbsolute(file.path));

  const header = [
    `- Sessão: \`${session.id}\` · ${session.repo ?? "?"} · branch \`${session.branch ?? "?"}\``,
    `- Pasta: \`${session.cwd ?? "?"}\``,
    `- Período: ${when(session.started_at)} → ${when(session.ended_at)} · ${session.prompt_count} prompts`,
    session.source === "transcript"
      ? `- Conversa original: \`${resumeCommand(session)}\``
      : "- Só os prompts sobreviveram: o Claude Code apagou o transcript antes do lembra existir.",
  ];
  const sections = [`# Handoff: ${session.title ?? "sessão sem título"}`, header.join("\n")];

  if (session.digest) sections.push(`## Resumo\n\n${session.digest}`);
  if (prompts[0]) sections.push(`## Pedido inicial\n\n${quote(clip(prompts[0].text, 1500))}`);
  if (lastSummary) sections.push(`## Último resumo do /compact\n\n${clip(lastSummary.text, 4000)}`);
  const recent = prompts.slice(1).slice(-RECENT_PROMPTS);
  if (recent.length) {
    sections.push(`## Últimos pedidos\n\n${recent.map((prompt) => `- ${when(prompt.ts)}: ${oneLine(prompt.text, 400)}`).join("\n")}`);
  }
  if (lastReply) sections.push(`## Onde parou (última resposta do Claude)\n\n${quote(clip(lastReply.text, 2000))}`);
  if (files.length) {
    const lines = files.map((file) => {
      const status = isMissing(file) ? ", apagado do disco" : "";
      const read = file.sha ? ` → \`lembra cat ${file.id}\`` : "";
      return `- \`${shortPath(file.path)}\` (${file.kind}${status})${read}`;
    });
    sections.push(`## Arquivos tocados\n\n${lines.join("\n")}`);
  }
  sections.push(
    "## Como continuar\n\n" +
      "Você está retomando o trabalho desta sessão. Confira o estado atual do repositório (`git status`, `git log -5`), " +
      "leia os arquivos relevantes e continue a partir dos últimos pedidos. Para ler um arquivo guardado, use `lembra cat <id>` " +
      "ou a ferramenta `get_file` do MCP lembra.",
  );
  return `${sections.join("\n\n")}\n`;
}
