import type { Locale } from "./locale";

// Text produced by src/core and shared by every interface: handoff briefs, pending reasons, summary prompts.

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const en = {
  prompts: (n: string, raw: number) => `${n} ${plural(raw, "prompt", "prompts")}`,
  handoff: {
    title: (title: string) => `# Handoff: ${title}`,
    untitled: "untitled session",
    session: (id: string, repo: string, branch: string) => `- Session: \`${id}\` · ${repo} · branch \`${branch}\``,
    folder: (cwd: string) => `- Folder: \`${cwd}\``,
    period: (start: string, end: string, prompts: string) => `- Period: ${start} → ${end} · ${prompts}`,
    original: (command: string) => `- Original conversation: \`${command}\``,
    promptsOnly: "- Only the prompts survived: Claude Code deleted the transcript before lembra existed.",
    summary: "## Summary",
    initialRequest: "## Initial request",
    lastCompact: "## Last /compact summary",
    recentRequests: "## Latest requests",
    whereItStopped: "## Where it stopped (Claude's last reply)",
    files: "## Files touched",
    deleted: ", deleted from disk",
    howToContinue:
      "## How to continue\n\nYou are picking up this session's work. Check the repository's current state (`git status`, `git log -5`), " +
      "read the relevant files and continue from the latest requests. To read a stored file, use `lembra cat <id>` " +
      "or the `get_file` tool of the lembra MCP server.",
  },
  pending: {
    "no-push": () => "never pushed",
    ahead: (n: number) => `${n} unpushed ${plural(n, "commit", "commits")}`,
    dirty: () => "uncommitted changes",
    "no-pr": () => "no PR",
    "pr-closed": () => "PR closed without merge",
  },
  summary: {
    speakers: { prompt: "user", reply: "claude", summary: "/compact summary", digest: "summary" },
    instructions:
      "Summarize this Claude Code session so someone can find it and pick the work up later.\n" +
      "Answer in English, in at most 6 lines, with no preamble.\n" +
      "Line 1: the session's goal in one sentence.\n" +
      "Then: what was done, key decisions, central files or commands, and what was left pending.\n" +
      "Use the words someone would search for: names of tables, modules, screens, errors, customers.",
    context: (repo: string, branch: string, title: string) => `Repository: ${repo} · branch: ${branch} · title: ${title}`,
  },
};

export type CoreCatalog = typeof en;

const ptBR: CoreCatalog = {
  prompts: (n, raw) => `${n} ${plural(raw, "prompt", "prompts")}`,
  handoff: {
    title: (title) => `# Handoff: ${title}`,
    untitled: "sessão sem título",
    session: (id, repo, branch) => `- Sessão: \`${id}\` · ${repo} · branch \`${branch}\``,
    folder: (cwd) => `- Pasta: \`${cwd}\``,
    period: (start, end, prompts) => `- Período: ${start} → ${end} · ${prompts}`,
    original: (command) => `- Conversa original: \`${command}\``,
    promptsOnly: "- Só os prompts sobreviveram: o Claude Code apagou o transcript antes do lembra existir.",
    summary: "## Resumo",
    initialRequest: "## Pedido inicial",
    lastCompact: "## Último resumo do /compact",
    recentRequests: "## Últimos pedidos",
    whereItStopped: "## Onde parou (última resposta do Claude)",
    files: "## Arquivos tocados",
    deleted: ", apagado do disco",
    howToContinue:
      "## Como continuar\n\nVocê está retomando o trabalho desta sessão. Confira o estado atual do repositório (`git status`, `git log -5`), " +
      "leia os arquivos relevantes e continue a partir dos últimos pedidos. Para ler um arquivo guardado, use `lembra cat <id>` " +
      "ou a ferramenta `get_file` do MCP lembra.",
  },
  pending: {
    "no-push": () => "branch nunca enviada",
    ahead: (n) => `${n} ${plural(n, "commit sem push", "commits sem push")}`,
    dirty: () => "alterações não commitadas",
    "no-pr": () => "sem PR",
    "pr-closed": () => "PR fechado sem merge",
  },
  summary: {
    speakers: { prompt: "usuário", reply: "claude", summary: "resumo do /compact", digest: "resumo" },
    instructions:
      "Resuma esta sessão do Claude Code para que alguém a encontre e retome o trabalho no futuro.\n" +
      "Responda em português do Brasil, em no máximo 6 linhas e sem introdução.\n" +
      "Linha 1: o objetivo da sessão numa frase.\n" +
      "Depois: o que foi feito, decisões importantes, arquivos ou comandos centrais e o que ficou pendente.\n" +
      "Use os termos que a pessoa usaria para buscar: nomes de tabelas, módulos, telas, erros, clientes.",
    context: (repo, branch, title) => `Repositório: ${repo} · branch: ${branch} · título: ${title}`,
  },
};

export const CORE: Record<Locale, CoreCatalog> = { en, "pt-BR": ptBR };
