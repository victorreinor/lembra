import type { Locale } from "./locale";

// Messages for LembraError codes. Core code throws codes; each interface renders them in its locale.

const en = {
  invalidDate: (p: { input: string }) => `Invalid date: ${p.input} (use 2026-10-01, 7d, 2w or 3m)`,
  invalidLimit: (p: { value: string }) => `--limit must be a positive number (got ${p.value}).`,
  invalidPort: (p: { value: string }) => `Invalid --port: ${p.value}`,
  invalidLanguage: (p: { value: string; supported: string }) => `Unknown language "${p.value}". Available: ${p.supported}.`,
  missingQuery: () => "Say what to look for: lembra search <terms>",
  missingSession: () => "Which session? Pass the start of its id or the name given with /rename. See: lembra --help",
  missingFile: () => "Which file? Pass its #id or its original path. See: lembra --help",
  sessionNotFound: (p: { ref: string }) => `No session with id or name "${p.ref}".`,
  sessionAmbiguous: (p: { ref: string; ids: string }) => `"${p.ref}" matches more than one session: ${p.ids}…`,
  promptsOnly: () =>
    "Claude Code deleted this session's transcript before lembra existed, so it cannot be resumed. Use the handoff to carry its context into a new session.",
  fileNotFound: (p: { ref: string }) => `File not found in the vault: ${p.ref}`,
  fileWithoutContent: (p: { path: string }) => `The vault knows ${p.path} was edited, but does not have that version's full content.`,
  destinationExists: (p: { dest: string }) => `${p.dest} already exists. Use --to <path> or --force.`,
  summaryFailed: (p: { code: number; detail: string }) => `claude -p failed with code ${p.code}: ${p.detail}`,
  summaryEmpty: (p: { id: string }) => `The summary of session ${p.id} came back empty.`,
  commandFailed: (p: { command: string; detail: string }) => `${p.command} failed: ${p.detail}`,
  noClipboard: () => "Could not find pbcopy, wl-copy or xclip to copy with.",
  terminalMacOnly: () => "Opening in Terminal only works on macOS for now.",
  missingParam: (p: { key: string }) => `Missing "${p.key}".`,
  paramNotText: (p: { key: string }) => `"${p.key}" must be text.`,
  paramNotPositive: (p: { key: string }) => `"${p.key}" must be a positive integer.`,
};

export type ErrorCatalog = typeof en;
export type ErrorCode = keyof ErrorCatalog;

const ptBR: ErrorCatalog = {
  invalidDate: (p) => `Data inválida: ${p.input} (use 2026-10-01, 01/10 ou 7d)`,
  invalidLimit: (p) => `--limit precisa ser um número positivo (recebi ${p.value}).`,
  invalidPort: (p) => `--port inválida: ${p.value}`,
  invalidLanguage: (p) => `Idioma desconhecido "${p.value}". Disponíveis: ${p.supported}.`,
  missingQuery: () => "Diga o que procurar: lembra search <termos>",
  missingSession: () => "Qual sessão? Informe o começo do id ou o nome dado com /rename. Veja: lembra --help",
  missingFile: () => "Qual arquivo? Informe o #id ou o caminho original. Veja: lembra --help",
  sessionNotFound: (p) => `Nenhuma sessão com id ou nome "${p.ref}".`,
  sessionAmbiguous: (p) => `"${p.ref}" é ambíguo: ${p.ids}…`,
  promptsOnly: () =>
    "O Claude Code apagou o transcript desta sessão antes do lembra existir, então não dá para retomá-la. Use o handoff para levar o contexto a uma sessão nova.",
  fileNotFound: (p) => `Arquivo não encontrado no cofre: ${p.ref}`,
  fileWithoutContent: (p) => `O cofre sabe que ${p.path} foi editado, mas não tem o conteúdo completo dessa versão.`,
  destinationExists: (p) => `${p.dest} já existe. Use --to <caminho> ou --force.`,
  summaryFailed: (p) => `claude -p terminou com erro ${p.code}: ${p.detail}`,
  summaryEmpty: (p) => `O resumo da sessão ${p.id} veio vazio.`,
  commandFailed: (p) => `${p.command} falhou: ${p.detail}`,
  noClipboard: () => "Não achei pbcopy, wl-copy nem xclip para copiar.",
  terminalMacOnly: () => "Abrir no Terminal só funciona no macOS por enquanto.",
  missingParam: (p) => `Informe "${p.key}".`,
  paramNotText: (p) => `"${p.key}" precisa ser texto.`,
  paramNotPositive: (p) => `"${p.key}" precisa ser um inteiro positivo.`,
};

export const ERRORS: Record<Locale, ErrorCatalog> = { en, "pt-BR": ptBR };
