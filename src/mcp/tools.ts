import type { Database } from "bun:sqlite";
import { isAbsolute } from "node:path";
import type { Services } from "../core/services";
import { LembraError } from "../core/errors";
import { isMissing, latestFiles, readStoredFile, resolveFile, sessionFiles } from "../core/files";
import { buildHandoff } from "../core/handoff";
import type { Paths } from "../core/paths";
import { describeReasons, findPending } from "../core/pending";
import { parseDate, type Filters } from "../core/query";
import { search } from "../core/search";
import { findSession, listSessions, resumeCommand, sessionMessages, type Session } from "../core/sessions";
import { bracketMatches, clip, oneLine, repoName, shortPath, when } from "../core/text";

export interface ToolContext {
  db: Database;
  paths: Paths;
  services: Services;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, object>; required?: string[] };
  run(ctx: ToolContext, args: Record<string, unknown>): Promise<string> | string;
}

const FILTERS = {
  repo: { type: "string", description: "Trecho do nome do repositório (ex.: billing-api)" },
  branch: { type: "string", description: "Trecho do nome da branch" },
  since: { type: "string", description: "A partir de: 2026-10-01, 01/10, 7d, 2w, 3m" },
  until: { type: "string", description: "Até (inclusive), mesmo formato de since" },
};
const LIMIT = { type: "integer", minimum: 1, maximum: 50, description: "Quantidade de resultados" };

function text(args: Record<string, unknown>, key: string, required = false): string | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === "") {
    if (required) throw new LembraError(`Informe "${key}".`);
    return undefined;
  }
  if (typeof value !== "string") throw new LembraError(`"${key}" precisa ser texto.`);
  return value;
}

function limitOf(args: Record<string, unknown>, fallback: number): number {
  const value = args.limit ?? fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw new LembraError('"limit" precisa ser um inteiro positivo.');
  return Math.min(value, 50);
}

function filtersOf(args: Record<string, unknown>): Filters {
  const since = text(args, "since");
  const until = text(args, "until");
  return {
    repo: text(args, "repo"),
    branch: text(args, "branch"),
    since: since ? parseDate(since) : undefined,
    until: until ? parseDate(until, true) : undefined,
  };
}

function sessionHeader(session: Session): string {
  const partial = session.source === "history" ? " · só prompts (transcript apagado)" : "";
  return `## ${session.title ?? "(sem título)"}\nid: ${session.id} · ${repoName(session.repo)} · ${session.branch ?? "sem branch"} · ${when(session.ended_at)} · ${session.prompt_count} prompts${partial}`;
}

export const TOOLS: Tool[] = [
  {
    name: "search_history",
    description:
      "Busca em todas as sessões do Claude Code deste computador, em todos os repositórios, inclusive as antigas: prompts do usuário, respostas, resumos e títulos. Use quando o usuário perguntar se já fez algo parecido, mencionar uma sessão, decisão, SQL ou arquivo de antes, ou quando contexto passado ajudaria. Devolve sessões com trechos; aprofunde com get_session ou handoff.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: 'Palavras-chave. Cada palavra casa como prefixo; use "aspas" para frase exata.' },
        ...FILTERS,
        prompts_only: { type: "boolean", description: "Buscar só no que o usuário escreveu" },
        limit: LIMIT,
      },
      required: ["query"],
    },
    run({ db }, args) {
      const hits = search(db, text(args, "query", true)!, filtersOf(args), {
        promptsOnly: args.prompts_only === true,
        limit: limitOf(args, 10),
      });
      if (!hits.length) return "Nada encontrado. Tente menos palavras, prefixos mais curtos ou remova filtros.";
      return hits
        .map((hit) => [sessionHeader(hit.session), ...hit.snippets.map((s) => `> [${s.role}] ${bracketMatches(oneLine(s.text, 300))}`)].join("\n"))
        .join("\n\n");
    },
  },
  {
    name: "list_sessions",
    description: "Lista as sessões mais recentes do Claude Code, com filtros por repositório, branch e período.",
    inputSchema: { type: "object", properties: { ...FILTERS, limit: LIMIT } },
    run({ db }, args) {
      const sessions = listSessions(db, filtersOf(args), limitOf(args, 15));
      if (!sessions.length) return "Nenhuma sessão.";
      return sessions.map((session) => `${sessionHeader(session)}\núltimo pedido: ${oneLine(session.last_prompt, 200)}`).join("\n\n");
    },
  },
  {
    name: "get_session",
    description:
      "Mostra uma sessão: resumo, todos os prompts do usuário (e as respostas, se pedido), resumos do /compact e arquivos tocados com seus ids.",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string", description: "Começo do id da sessão ou o nome dado com /rename" },
        include_replies: { type: "boolean", description: "Incluir as respostas do Claude (mais longo)" },
        max_chars: { type: "integer", minimum: 1000, description: "Limite de tamanho da resposta (padrão 20000)" },
      },
      required: ["session"],
    },
    run({ db }, args) {
      const session = findSession(db, text(args, "session", true)!);
      const parts = [sessionHeader(session), `pasta: ${session.cwd ?? "?"}`];
      if (session.source === "transcript") parts.push(`retomar: ${resumeCommand(session)}`);
      if (session.digest) parts.push(`\n### Resumo\n${session.digest}`);
      parts.push("\n### Conversa");
      for (const message of sessionMessages(db, session.id, { replies: args.include_replies === true })) {
        parts.push(`[${message.role} · ${when(message.ts)}] ${message.text}`);
      }
      const files = sessionFiles(db, session.id).filter((file) => isAbsolute(file.path));
      if (files.length) {
        parts.push("\n### Arquivos");
        for (const file of files) parts.push(`#${file.id} ${file.kind} ${shortPath(file.path)}${isMissing(file) ? " (apagado do disco)" : ""}`);
      }
      return clip(parts.join("\n"), typeof args.max_chars === "number" ? args.max_chars : 20_000);
    },
  },
  {
    name: "handoff",
    description:
      "Gera o resumo de passagem de uma sessão (objetivo, últimos pedidos, onde parou, arquivos) para continuar aquele trabalho nesta conversa.",
    inputSchema: {
      type: "object",
      properties: { session: { type: "string", description: "Começo do id da sessão ou o nome dado com /rename" } },
      required: ["session"],
    },
    run({ db }, args) {
      return buildHandoff(db, findSession(db, text(args, "session", true)!));
    },
  },
  {
    name: "list_files",
    description:
      "Lista arquivos que o Claude criou, editou ou leu em sessões passadas (versão mais recente de cada caminho), inclusive os que já foram apagados do disco.",
    inputSchema: {
      type: "object",
      properties: {
        term: { type: "string", description: "Trecho do caminho (ex.: .sql, relatorio)" },
        repo: FILTERS.repo,
        since: FILTERS.since,
        missing: { type: "boolean", description: "Só os que não existem mais no disco" },
        limit: LIMIT,
      },
    },
    run({ db }, args) {
      const since = text(args, "since");
      let files = latestFiles(db, { term: text(args, "term"), repo: text(args, "repo"), since: since ? parseDate(since) : undefined });
      if (args.missing === true) files = files.filter(isMissing);
      if (!files.length) return "Nenhum arquivo.";
      return files
        .slice(0, limitOf(args, 20))
        .map((file) => `#${file.id} ${when(file.ts)} ${file.kind} ${repoName(file.repo)} ${shortPath(file.path)}${isMissing(file) ? " (apagado do disco)" : ""}`)
        .join("\n");
    },
  },
  {
    name: "get_file",
    description: "Lê o conteúdo guardado de um arquivo do cofre, mesmo que tenha sido apagado do disco.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Id do arquivo (#123) ou o caminho original" },
        max_chars: { type: "integer", minimum: 1000, description: "Limite de tamanho (padrão 50000)" },
      },
      required: ["file"],
    },
    run({ db }, args) {
      const file = resolveFile(db, text(args, "file", true)!);
      const data = readStoredFile(db, file);
      if (data.includes(0)) return `${file.path} é binário (${data.byteLength} bytes). Para recuperar: lembra restore ${file.id}`;
      const header = `${file.path} · versão de ${when(file.ts)}${isMissing(file) ? " · apagado do disco (lembra restore " + file.id + ")" : ""}\n\n`;
      return header + clip(new TextDecoder().decode(data), typeof args.max_chars === "number" ? args.max_chars : 50_000);
    },
  },
  {
    name: "pending_work",
    description:
      "Lista branches com sessões recentes cujo trabalho não foi entregue: sem push, commits sem push, alterações não commitadas ou sem PR.",
    inputSchema: { type: "object", properties: { since: { ...FILTERS.since, description: "Período analisado (padrão 14d)" } } },
    async run({ db, services }, args) {
      const items = await findPending(db, { since: parseDate(text(args, "since") ?? "14d"), probe: services.git });
      if (!items.length) return "Nada pendente: toda branch com sessão recente foi enviada e tem PR.";
      return items
        .map((item) => `${repoName(item.repo)} · ${item.branch}: ${describeReasons(item).join(", ")} (última sessão ${item.lastSession.id.slice(0, 8)}, ${when(item.lastSession.ended_at)})`)
        .join("\n");
    },
  },
];
