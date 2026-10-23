import type { Locale } from "./locale";

// Tool results of the MCP server. Tool descriptions stay in English (they are read by the model);
// results follow the user's language, since Claude often quotes them back.

const en = {
  untitled: "(untitled)",
  noBranch: "no branch",
  promptsOnly: " · prompts only (transcript deleted)",
  header: (title: string, id: string, repo: string, branch: string, when: string, prompts: number) =>
    `## ${title}\nid: ${id} · ${repo} · ${branch} · ${when} · ${prompts} prompts`,
  nothingFound: "Nothing found. Try fewer words, shorter prefixes or fewer filters.",
  noSessions: "No sessions.",
  lastRequest: (text: string) => `last request: ${text}`,
  folder: (cwd: string) => `folder: ${cwd}`,
  resume: (command: string) => `resume: ${command}`,
  summary: "### Summary",
  conversation: "### Conversation",
  files: "### Files",
  deleted: " (deleted from disk)",
  noFiles: "No files.",
  binary: (path: string, bytes: number, id: number) => `${path} is binary (${bytes} bytes). To recover it: lembra restore ${id}`,
  version: (path: string, when: string) => `${path} · version from ${when}`,
  restoreHint: (id: number) => ` · deleted from disk (lembra restore ${id})`,
  secretsMasked: (n: number, id: number) => ` · ${n} ${n === 1 ? "secret" : "secrets"} masked (the original: lembra cat ${id})`,
  nothingPending: "Nothing pending: every branch with a recent session was pushed and has a PR.",
  pending: (repo: string, branch: string, reasons: string, id: string, when: string) => `${repo} · ${branch}: ${reasons} (last session ${id}, ${when})`,
};

export type McpCatalog = typeof en;

const ptBR: McpCatalog = {
  untitled: "(sem título)",
  noBranch: "sem branch",
  promptsOnly: " · só prompts (transcript apagado)",
  header: (title, id, repo, branch, when, prompts) => `## ${title}\nid: ${id} · ${repo} · ${branch} · ${when} · ${prompts} prompts`,
  nothingFound: "Nada encontrado. Tente menos palavras, prefixos mais curtos ou remova filtros.",
  noSessions: "Nenhuma sessão.",
  lastRequest: (text) => `último pedido: ${text}`,
  folder: (cwd) => `pasta: ${cwd}`,
  resume: (command) => `retomar: ${command}`,
  summary: "### Resumo",
  conversation: "### Conversa",
  files: "### Arquivos",
  deleted: " (apagado do disco)",
  noFiles: "Nenhum arquivo.",
  binary: (path, bytes, id) => `${path} é binário (${bytes} bytes). Para recuperar: lembra restore ${id}`,
  version: (path, when) => `${path} · versão de ${when}`,
  restoreHint: (id) => ` · apagado do disco (lembra restore ${id})`,
  secretsMasked: (n, id) => ` · ${n} ${n === 1 ? "segredo mascarado" : "segredos mascarados"} (original: lembra cat ${id})`,
  nothingPending: "Nada pendente: toda branch com sessão recente foi enviada e tem PR.",
  pending: (repo, branch, reasons, id, when) => `${repo} · ${branch}: ${reasons} (última sessão ${id}, ${when})`,
};

export const MCP: Record<Locale, McpCatalog> = { en, "pt-BR": ptBR };
