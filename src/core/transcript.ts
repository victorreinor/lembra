// digest: the AI summary written by `lembra summarize`.
export type Role = "prompt" | "reply" | "summary" | "digest";

export interface Message {
  uid: string;
  role: Role;
  text: string;
}

export type FileOp =
  | { uid: string; kind: "write" | "read"; path: string; content: string }
  | { uid: string; kind: "edit"; path: string; oldText: string; newText: string; replaceAll: boolean; original?: string }
  | { uid: string; kind: "image"; path: string; base64: string };

export interface ParsedRecord {
  ts?: string;
  cwd?: string;
  branch?: string;
  sidechain: boolean;
  messages: Message[];
  files: FileOp[];
  aiTitle?: string;
  customTitle?: string;
  cost?: { usd?: number; added?: number; removed?: number };
}

// Bump whenever parsing extracts something new: the indexer then re-reads every transcript.
// Replaying is safe because messages and files are keyed by uid.
export const PARSER_VERSION = 1;

const PARSED_TYPES = new Set(["user", "assistant", "attachment", "ai-title", "custom-title", "cost-state"]);
const NOISE_PREFIXES = [
  "<local-command-stdout>",
  "<local-command-stderr>",
  "<local-command-caveat>",
  "Caveat: The messages below",
  "[Request interrupted",
];
const SKIPPED_READS = /\/(?:\.claude|node_modules)\//;
const PATH_PATTERN = /(?:~|\/(?:Users|tmp|private|var|Volumes))\/[^\s'"`<>()[\]{},;|]+/g;

// Most lines are bookkeeping (modes, raw API requests); skip them before paying for JSON.parse.
export function shouldParse(line: string): boolean {
  if (!line.startsWith('{"type":"')) return line.length > 0;
  return PARSED_TYPES.has(line.slice(9, line.indexOf('"', 9)));
}

export function parseRecord(rec: any): ParsedRecord {
  const out: ParsedRecord = {
    ts: rec.timestamp,
    cwd: rec.cwd,
    branch: rec.gitBranch || undefined,
    sidechain: Boolean(rec.isSidechain),
    messages: [],
    files: [],
  };
  switch (rec.type) {
    case "ai-title":
      out.aiTitle = rec.aiTitle;
      break;
    case "custom-title":
      out.customTitle = rec.customTitle;
      break;
    case "cost-state":
      out.cost = { usd: rec.totalCostUSD, added: rec.totalLinesAdded, removed: rec.totalLinesRemoved };
      break;
    case "user":
      if (rec.uuid) parseUser(rec, out);
      break;
    case "attachment":
      if (rec.uuid) parseQueuedPrompt(rec, out);
      break;
    case "assistant": {
      const text = textOf(rec.message?.content);
      if (rec.uuid && text && !out.sidechain) out.messages.push({ uid: rec.uuid, role: "reply", text });
      break;
    }
  }
  return out;
}

// Messages typed while Claude is mid-turn arrive as queued_command attachments, not as user records.
function parseQueuedPrompt(rec: any, out: ParsedRecord) {
  const queued = rec.attachment;
  if (out.sidechain || queued?.type !== "queued_command") return;
  if ((queued.commandMode ?? "prompt") !== "prompt" || (queued.origin?.kind ?? "human") !== "human") return;
  const prompt = normalizePrompt(textOf(queued.prompt));
  if (prompt) out.messages.push({ uid: rec.uuid, role: "prompt", text: prompt });
}

function parseUser(rec: any, out: ParsedRecord) {
  const content = rec.message?.content;
  const blocks: any[] = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
  const toolResult = blocks.find((block) => block?.type === "tool_result");
  if (toolResult) {
    const result = rec.toolUseResult;
    const op = result && typeof result === "object" ? fileOp(result, toolResult.tool_use_id ?? rec.uuid, rec.cwd) : undefined;
    if (op) out.files.push(op);
    return;
  }
  if (out.sidechain || rec.isMeta) return;
  if (rec.isCompactSummary) {
    const text = textOf(blocks);
    if (text) out.messages.push({ uid: rec.uuid, role: "summary", text });
    return;
  }
  if (!isHuman(rec)) return;
  const prompt = normalizePrompt(textOf(blocks));
  if (prompt) out.messages.push({ uid: rec.uuid, role: "prompt", text: prompt });
  blocks.forEach((block, i) => {
    if (block?.type !== "image" || block.source?.type !== "base64") return;
    const ext = String(block.source.media_type ?? "image/png").split("/")[1];
    out.files.push({ uid: `${rec.uuid}:${i}`, kind: "image", path: `imagem-${rec.uuid.slice(0, 8)}-${i}.${ext}`, base64: block.source.data });
  });
}

function fileOp(result: any, uid: string, cwd?: string): FileOp | undefined {
  if (typeof result.filePath === "string") {
    if ((result.type === "create" || result.type === "update") && typeof result.content === "string") {
      return { uid, kind: "write", path: result.filePath, content: result.content };
    }
    if (typeof result.oldString === "string" && typeof result.newString === "string") {
      return {
        uid,
        kind: "edit",
        path: result.filePath,
        oldText: result.oldString,
        newText: result.newString,
        replaceAll: Boolean(result.replaceAll),
        original: typeof result.originalFile === "string" ? result.originalFile : undefined,
      };
    }
    return;
  }
  // Reads only matter for files outside the repo (Downloads, /tmp…); the repo itself has git.
  const file = result.file;
  if (result.type !== "text" || typeof file?.filePath !== "string" || typeof file.content !== "string") return;
  if (file.startLine !== 1 || file.numLines !== file.totalLines) return;
  if (SKIPPED_READS.test(file.filePath) || (cwd && file.filePath.startsWith(`${cwd}/`))) return;
  return { uid, kind: "read", path: file.filePath, content: file.content };
}

function isHuman(rec: any): boolean {
  if (rec.promptSource === "system") return false;
  if (rec.turnOrigin && rec.turnOrigin !== "human") return false;
  const origin = rec.origin?.kind;
  return !origin || origin === "human";
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n\n")
    .trim();
}

export function normalizePrompt(raw: string): string | null {
  let text = raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
  if (NOISE_PREFIXES.some((prefix) => text.startsWith(prefix))) return null;
  const command = text.match(/<command-name>([\s\S]*?)<\/command-name>/);
  if (command) {
    const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim();
    text = args ? `${command[1]!.trim()} ${args}` : command[1]!.trim();
  }
  text = text.replace(/<\/?pasted_content[^>]*>/g, "").trim();
  return text || null;
}

export function historyPrompt(entry: any): string | null {
  const pasted = Object.values(entry.pastedContents ?? {})
    .map((paste: any) => (typeof paste?.content === "string" ? paste.content : ""))
    .filter(Boolean);
  return normalizePrompt([entry.display ?? "", ...pasted].join("\n\n"));
}

export function findPaths(text: string): string[] {
  return [...new Set((text.match(PATH_PATTERN) ?? []).map((path) => path.replace(/[.:!?]+$/, "")))];
}

// Mirrors the Edit tool: replace the first occurrence (or all of them), and fail when old text is absent.
export function applyEdit(base: string, edit: { oldText: string; newText: string; replaceAll: boolean }): string | undefined {
  if (!edit.oldText || !base.includes(edit.oldText)) return undefined;
  return edit.replaceAll ? base.split(edit.oldText).join(edit.newText) : base.replace(edit.oldText, () => edit.newText);
}
