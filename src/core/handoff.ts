import type { Database } from "bun:sqlite";
import { CORE } from "../i18n/core";
import type { Locale } from "../i18n/locale";
import { isMissing, sessionFiles } from "./files";
import { resumeCommand, sessionMessages, type Session } from "./sessions";
import { clip, oneLine, shortPath, textFormat } from "./text";

const RECENT_PROMPTS = 8;

const quote = (text: string) => text.replace(/^/gm, "> ");

// A Markdown brief that lets a fresh Claude session pick up where another one stopped.
export function buildHandoff(db: Database, session: Session, locale: Locale): string {
  const t = CORE[locale];
  const format = textFormat(locale);
  const messages = sessionMessages(db, session.id, { replies: true });
  const prompts = messages.filter((message) => message.role === "prompt");
  const lastSummary = messages.findLast((message) => message.role === "summary");
  const lastReply = messages.findLast((message) => message.role === "reply");
  const files = sessionFiles(db, session.id).filter((file) => file.kind !== "image");
  const command = resumeCommand(session);

  const header = [
    t.handoff.session(session.id, session.repo ?? "?", session.branch ?? "?"),
    t.handoff.folder(session.cwd ?? "?"),
    t.handoff.period(format.when(session.started_at), format.when(session.ended_at), t.prompts(format.count(session.prompt_count), session.prompt_count)),
    command ? t.handoff.original(command) : t.handoff.promptsOnly,
  ];
  const sections = [t.handoff.title(session.title ?? t.handoff.untitled), header.join("\n")];

  if (session.digest) sections.push(`${t.handoff.summary}\n\n${session.digest}`);
  if (prompts[0]) sections.push(`${t.handoff.initialRequest}\n\n${quote(clip(prompts[0].text, 1500))}`);
  if (lastSummary) sections.push(`${t.handoff.lastCompact}\n\n${clip(lastSummary.text, 4000)}`);
  const recent = prompts.slice(1).slice(-RECENT_PROMPTS);
  if (recent.length) {
    sections.push(`${t.handoff.recentRequests}\n\n${recent.map((prompt) => `- ${format.when(prompt.ts)}: ${oneLine(prompt.text, 400)}`).join("\n")}`);
  }
  if (lastReply) sections.push(`${t.handoff.whereItStopped}\n\n${quote(clip(lastReply.text, 2000))}`);
  if (files.length) {
    const lines = files.map((file) => {
      const read = file.sha ? ` → \`lembra cat ${file.id}\`` : "";
      return `- \`${shortPath(file.path)}\` (${file.kind}${isMissing(file) ? t.handoff.deleted : ""})${read}`;
    });
    sections.push(`${t.handoff.files}\n\n${lines.join("\n")}`);
  }
  sections.push(t.handoff.howToContinue);
  return `${sections.join("\n\n")}\n`;
}
