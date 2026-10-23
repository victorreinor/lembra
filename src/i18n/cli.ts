import type { Locale } from "./locale";

// Everything the `lembra` command prints. Counts and dates arrive already formatted for the locale.

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const HELP_EN = `lembra — permanent, searchable history for Claude Code

Find and resume
  lembra ui                     open the search page in the browser (localhost:4747)
  lembra                        most recent sessions
  lembra <terms>                search (shortcut for "lembra search")
  lembra search <terms>         search prompts, replies, summaries and titles
  lembra list                   sessions by date
  lembra show <session>         summary, prompts, files and the command to resume
  lembra resume <session>       reopen the session in Claude Code, in the right folder
  lembra handoff <session>      brief to continue in a new terminal (-c copies it)

Files
  lembra files [part]           files Claude created, edited or read
  lembra restore <file>         put a file from the vault back on disk
  lembra cat <file>             print a file from the vault

Follow-up
  lembra pending                branches with recent sessions and undelivered work
  lembra summarize [session]    summarize sessions with Claude (Haiku) on your login

Setup
  lembra install                set everything up: PATH, retention, plugin, page, daily index
  lembra uninstall              undo install (your data stays in ~/.lembra)
  lembra lang [en|pt-BR|auto]   show or set the language

Maintenance
  lembra index                  index and archive everything (incremental)
  lembra stats                  vault size and Claude Code retention

Used by the Claude Code plugin
  lembra mcp                    MCP server: Claude itself searches your history
  lembra hook                   index and archive when a session ends and before /compact

Options
  -r, --repo <name>            filter by repository (part of the name)
  -b, --branch <name>          filter by branch (part of the name)
      --since <date>           from: 2026-10-01, 7d, 2w, 3m (day/month like 01/10 also works)
      --until <date>           until (inclusive)
  -p, --prompts                only your own prompts (search)
      --missing                only files gone from disk (files)
  -n, --limit <n>              number of results
      --full                   full prompts (show)
      --to <path>              destination file or folder (restore)
  -f, --force                  overwrite the destination (restore)
      --print                  only print the command, do not open it (resume)
  -c, --copy                   copy to the clipboard (handoff)
      --model <name>           model for summaries, default haiku (summarize)
      --port <n>               page port, default 4747 (ui)
      --serve                  only start the server, do not open the browser (ui)
      --dry-run                show what would change without changing it (install)
      --lang <en|pt-BR>        language for this run

Examples
  lembra billing --repo api --since 7d
  lembra "monthly report" --prompts
  lembra files .sql --missing
  lembra restore 1234 --to ~/Desktop
  lembra handoff 3f2a --copy
  lembra pending --since 30d

<session>  start of the id (3f2a) or the name given with /rename
<file>     the #id shown by files/show, or the original path`;

const HELP_PT = `lembra — o histórico permanente e pesquisável do Claude Code

Buscar e retomar
  lembra ui                     abre a página de busca no navegador (localhost:4747)
  lembra                        sessões mais recentes
  lembra <termos>               busca (atalho de "lembra search")
  lembra search <termos>        busca em prompts, respostas, resumos e títulos
  lembra list                   sessões por data
  lembra show <sessão>          resumo, prompts, arquivos e o comando para retomar
  lembra resume <sessão>        reabre a sessão no Claude Code, na pasta certa
  lembra handoff <sessão>       resumo pronto para continuar num terminal novo (-c copia)

Arquivos
  lembra files [trecho]         arquivos que o Claude criou, editou ou leu
  lembra restore <arquivo>      restaura um arquivo do cofre
  lembra cat <arquivo>          imprime um arquivo do cofre

Acompanhamento
  lembra pending                branches com sessão recente e trabalho não entregue
  lembra summarize [sessão]     resume sessões com o Claude (Haiku) usando seu login

Instalação
  lembra install                configura tudo: PATH, retenção, plugin, página e indexação diária
  lembra uninstall              desfaz o install (mantém seus dados em ~/.lembra)
  lembra lang [en|pt-BR|auto]   mostra ou define o idioma

Manutenção
  lembra index                  indexa e arquiva tudo (incremental)
  lembra stats                  tamanho do cofre e retenção do Claude Code

Usados pelo plugin do Claude Code
  lembra mcp                    servidor MCP: o próprio Claude consulta o histórico
  lembra hook                   indexa e arquiva ao fim da sessão e antes do /compact

Opções
  -r, --repo <nome>            filtra por repositório (trecho do nome)
  -b, --branch <nome>          filtra por branch (trecho do nome)
      --since <data>           a partir de: 2026-10-01, 01/10, 7d, 2w, 3m
      --until <data>           até (inclusive)
  -p, --prompts                só os seus prompts (search)
      --missing                só arquivos que não existem mais no disco (files)
  -n, --limit <n>              quantidade de resultados
      --full                   prompts completos (show)
      --to <caminho>           destino do arquivo (restore)
  -f, --force                  sobrescreve o destino (restore)
      --print                  só mostra o comando, sem abrir (resume)
  -c, --copy                   copia para a área de transferência (handoff)
      --model <nome>           modelo dos resumos, padrão haiku (summarize)
      --port <n>               porta da página, padrão 4747 (ui)
      --serve                  só sobe o servidor, sem abrir o navegador (ui)
      --dry-run                mostra o que mudaria, sem mudar nada (install)
      --lang <en|pt-BR>        idioma desta execução

Exemplos
  lembra faturamento --repo billing --since 7d
  lembra "relatório mensal" --prompts
  lembra files .sql --missing
  lembra restore 1234 --to ~/Desktop
  lembra handoff 3f2a --copy
  lembra pending --since 30d

<sessão>  começo do id (3f2a) ou o nome dado com /rename
<arquivo> o #id mostrado em files/show, ou o caminho original`;

const en = {
  help: HELP_EN,
  seeHelp: "See: lembra --help",
  firstRun: "Indexing your history for the first time; this may take a minute…",
  untitled: "(untitled)",
  promptsOnlyBadge: "[prompts only]",
  prompts: (n: string, raw: number) => `${n} ${plural(raw, "prompt", "prompts")}`,
  search: { none: "Nothing found.", hint: "lembra show <id> for details · lembra resume <id> to continue" },
  list: { none: "No sessions.", last: (prompts: string, last: string) => `${prompts} · last: ${last}` },
  show: {
    noBranch: "no branch",
    cost: (usd: string) => `US$ ${usd}`,
    lines: (added: number, removed: number) => `+${added}/-${removed} lines`,
    promptsOnly: "Only the prompts: Claude Code deleted the transcript before lembra existed.",
    resume: "Resume:",
    summary: "Summary",
    prompts: "Prompts",
    compact: "≡ /compact summary",
    files: "Files",
  },
  fileStatus: { partial: "no full content", image: "pasted image", missing: "deleted from disk", disk: "on disk" },
  versions: (n: string) => `${n} versions`,
  fileHint: "lembra restore <#id> [--to path] · lembra cat <#id>",
  resume: { restored: "Transcript restored from the vault.", folderGone: (path: string) => `The folder ${path} no longer exists.` },
  handoff: { copied: "Copied. Paste it into a new Claude Code session to continue where it stopped." },
  files: { none: "No files.", more: (n: string) => `… and ${n} more (use --limit)` },
  restore: { done: "Restored", detail: (size: string, when: string) => `(${size}, version from ${when})` },
  pending: {
    checking: "Checking git and GitHub…",
    none: "Nothing pending: every branch with a recent session was pushed and has a PR.",
    last: (sessions: number, when: string) => `${sessions} ${plural(sessions, "session", "sessions")} · last ${when}`,
  },
  summarize: {
    none: "No new sessions to summarize.",
    running: (n: number, model: string) => `Summarizing ${n} ${plural(n, "session", "sessions")} with ${model}…`,
  },
  index: {
    done: (seconds: string) => `Indexed in ${seconds}s`,
    changed: (changed: string, scanned: string) => `${changed} of ${scanned} transcripts had changes`,
    counts: (messages: string, files: string, history: string) => `${messages} messages · ${files} files · ${history} old prompts from history.jsonl`,
  },
  stats: {
    sessions: { label: "Sessions", value: (transcript: string, history: string, since: string) => `${transcript} with transcript · ${history} prompts only · since ${since}` },
    messages: { label: "Messages", value: (prompts: string, replies: string, summaries: string) => `${prompts} prompts · ${replies} replies · ${summaries} /compact summaries` },
    files: { label: "Files", value: (paths: string, versions: string, missing: string) => `${paths} paths · ${versions} versions · ${missing} deleted from disk and recoverable` },
    vault: { label: "Vault", value: (db: string, raw: string) => `${db} database · ${raw} of raw transcripts (zstd)` },
    claude: { label: "Claude Code", value: (size: string, dir: string, retention: string) => `${size} in ${dir} · retention: ${retention}` },
    security: { label: "Secrets", value: (messages: string, files: string) => `masked in ${messages} messages · ${files} stored files contain secrets (kept intact for restore)` },
    days: (n: string) => `${n} days`,
    defaultRetention: "30 days (default): Claude Code deletes old transcripts. Run lembra install or set cleanupPeriodDays.",
  },
  ui: {
    opened: (url: string) => `Opened ${url}`,
    alreadyRunning: "(the server was already running)",
    serving: (url: string) => `lembra at ${url}`,
    stop: "· Ctrl+C to stop",
    nothingToDo: (url: string) => `lembra is already running at ${url}; nothing to do.`,
  },
  lang: {
    current: (locale: string, source: string) => `Language: ${locale} (${source})`,
    sources: { flag: "from --lang", env: "from LEMBRA_LANG", config: "set with lembra lang", system: "from the system" },
    set: (locale: string) => `Language set to ${locale}. The page, MCP and hooks follow it too.`,
    auto: "Language back to automatic (system locale).",
    available: (list: string) => `Available: ${list}, auto`,
  },
  install: {
    steps: { link: "command on PATH", retention: "Claude Code retention", plugin: "Claude Code plugin", agents: "background services", index: "index" },
    linkOk: (target: string, entry: string) => `${target} → ${entry}`,
    linkForeign: (target: string) => `${target} already exists and points elsewhere; left as is`,
    linkAddPath: " (add ~/.local/bin to your PATH)",
    retentionOk: (days: number) => `cleanupPeriodDays = ${days}`,
    retentionSet: (days: number) => `cleanupPeriodDays = ${days} (backup at settings.json.lembra-backup)`,
    noClaude: "the claude command is not on PATH",
    pluginOk: (id: string) => `${id} installed (MCP, hooks and /lembra:handoff)`,
    pluginWould: (id: string, root: string) => `would install ${id} from ${root}`,
    pluginInstalled: (id: string) => `${id} installed; takes effect from the next Claude Code session`,
    pluginRemoved: (id: string) => `${id} removed`,
    pluginAbsent: "was not installed",
    agentsNotMac: "launchd only exists on macOS; run lembra ui by hand",
    agentsOk: "page at localhost:4747 and daily index at 12:30",
    agentsWould: (labels: string) => `would create ${labels}`,
    agentsInstalled: "page at localhost:4747 (starts at login) and daily index at 12:30",
    agentsRemoved: (labels: string) => `removed: ${labels}`,
    nothingInstalled: "nothing installed",
    linkRemoved: (target: string) => `${target} removed`,
    noLink: "no lembra link",
    indexed: (scanned: string, messages: string) => `${scanned} transcripts, ${messages} new messages`,
    dryRun: "Nothing was changed (--dry-run).",
    ready: (url: string, ui: string) => `Ready. Open ${url} (or ${ui}).`,
    next: 'In a new Claude Code session, ask "have I done something like this before?" or use /lembra:handoff <session>.',
    dataKept: (dir: string) => `Your data stays in ${dir}. To delete it: rm -rf ${dir}`,
  },
  hookFailed: (message: string) => `lembra hook: ${message}`,
};

export type CliCatalog = typeof en;

const ptBR: CliCatalog = {
  help: HELP_PT,
  seeHelp: "Veja: lembra --help",
  firstRun: "Primeira indexação do histórico; pode levar um minuto…",
  untitled: "(sem título)",
  promptsOnlyBadge: "[só prompts]",
  prompts: (n, raw) => `${n} ${plural(raw, "prompt", "prompts")}`,
  search: { none: "Nada encontrado.", hint: "lembra show <id> para detalhes · lembra resume <id> para continuar" },
  list: { none: "Nenhuma sessão.", last: (prompts, last) => `${prompts} · último: ${last}` },
  show: {
    noBranch: "sem branch",
    cost: (usd) => `US$ ${usd}`,
    lines: (added, removed) => `+${added}/-${removed} linhas`,
    promptsOnly: "Só os prompts: o Claude Code apagou o transcript antes do lembra existir.",
    resume: "Retomar:",
    summary: "Resumo",
    prompts: "Prompts",
    compact: "≡ resumo do /compact",
    files: "Arquivos",
  },
  fileStatus: { partial: "sem conteúdo completo", image: "imagem colada", missing: "apagado do disco", disk: "no disco" },
  versions: (n) => `${n} versões`,
  fileHint: "lembra restore <#id> [--to caminho] · lembra cat <#id>",
  resume: { restored: "Transcript restaurado a partir do cofre.", folderGone: (path) => `A pasta ${path} não existe mais.` },
  handoff: { copied: "Copiado. Cole numa sessão nova do Claude Code para continuar de onde parou." },
  files: { none: "Nenhum arquivo.", more: (n) => `… e mais ${n} (use --limit)` },
  restore: { done: "Restaurado", detail: (size, when) => `(${size}, versão de ${when})` },
  pending: {
    checking: "Consultando git e GitHub…",
    none: "Nada pendente: toda branch com sessão recente foi enviada e tem PR.",
    last: (sessions, when) => `${sessions} ${plural(sessions, "sessão", "sessões")} · última ${when}`,
  },
  summarize: {
    none: "Nenhuma sessão nova para resumir.",
    running: (n, model) => `Resumindo ${n} ${plural(n, "sessão", "sessões")} com ${model}…`,
  },
  index: {
    done: (seconds) => `Indexado em ${seconds}s`,
    changed: (changed, scanned) => `${changed} de ${scanned} transcripts com novidades`,
    counts: (messages, files, history) => `${messages} mensagens · ${files} arquivos · ${history} prompts antigos do history.jsonl`,
  },
  stats: {
    sessions: { label: "Sessões", value: (transcript, history, since) => `${transcript} com transcript · ${history} só com prompts · desde ${since}` },
    messages: { label: "Mensagens", value: (prompts, replies, summaries) => `${prompts} prompts · ${replies} respostas · ${summaries} resumos de /compact` },
    files: { label: "Arquivos", value: (paths, versions, missing) => `${paths} caminhos · ${versions} versões · ${missing} apagados do disco e recuperáveis` },
    vault: { label: "Cofre", value: (db, raw) => `${db} no banco · ${raw} de transcripts brutos (zstd)` },
    claude: { label: "Claude Code", value: (size, dir, retention) => `${size} em ${dir} · retenção: ${retention}` },
    security: { label: "Segredos", value: (messages, files) => `mascarados em ${messages} mensagens · ${files} arquivos guardados contêm segredos (intactos para o restore)` },
    days: (n) => `${n} dias`,
    defaultRetention: "30 dias (padrão): o Claude Code apaga transcripts antigos. Rode lembra install ou configure cleanupPeriodDays.",
  },
  ui: {
    opened: (url) => `Aberto ${url}`,
    alreadyRunning: "(o servidor já estava rodando)",
    serving: (url) => `lembra em ${url}`,
    stop: "· Ctrl+C para parar",
    nothingToDo: (url) => `Já existe um lembra rodando em ${url}; nada a fazer.`,
  },
  lang: {
    current: (locale, source) => `Idioma: ${locale} (${source})`,
    sources: { flag: "pelo --lang", env: "pelo LEMBRA_LANG", config: "definido com lembra lang", system: "do sistema" },
    set: (locale) => `Idioma definido como ${locale}. A página, o MCP e os hooks também passam a usá-lo.`,
    auto: "Idioma de volta ao automático (idioma do sistema).",
    available: (list) => `Disponíveis: ${list}, auto`,
  },
  install: {
    steps: { link: "comando no PATH", retention: "retenção do Claude Code", plugin: "plugin do Claude Code", agents: "serviços em segundo plano", index: "índice" },
    linkOk: (target, entry) => `${target} → ${entry}`,
    linkForeign: (target) => `${target} já existe e aponta para outro lugar; deixei como está`,
    linkAddPath: " (adicione ~/.local/bin ao PATH)",
    retentionOk: (days) => `cleanupPeriodDays = ${days}`,
    retentionSet: (days) => `cleanupPeriodDays = ${days} (backup em settings.json.lembra-backup)`,
    noClaude: "o comando claude não está no PATH",
    pluginOk: (id) => `${id} instalado (MCP, hooks e /lembra:handoff)`,
    pluginWould: (id, root) => `instalaria ${id} a partir de ${root}`,
    pluginInstalled: (id) => `${id} instalado; vale a partir da próxima sessão do Claude Code`,
    pluginRemoved: (id) => `${id} removido`,
    pluginAbsent: "não estava instalado",
    agentsNotMac: "launchd só existe no macOS; rode lembra ui manualmente",
    agentsOk: "página em localhost:4747 e indexação diária às 12:30",
    agentsWould: (labels) => `criaria ${labels}`,
    agentsInstalled: "página em localhost:4747 (sobe no login) e indexação diária às 12:30",
    agentsRemoved: (labels) => `removidos: ${labels}`,
    nothingInstalled: "nada instalado",
    linkRemoved: (target) => `${target} removido`,
    noLink: "nenhum link do lembra",
    indexed: (scanned, messages) => `${scanned} transcripts, ${messages} mensagens novas`,
    dryRun: "Nada foi alterado (--dry-run).",
    ready: (url, ui) => `Pronto. Abra ${url} (ou ${ui}).`,
    next: 'Numa sessão nova do Claude Code, pergunte "já fiz algo parecido?" ou use /lembra:handoff <sessão>.',
    dataKept: (dir) => `Seus dados continuam em ${dir}. Para apagar: rm -rf ${dir}`,
  },
  hookFailed: (message) => `lembra hook: ${message}`,
};

export const CLI: Record<Locale, CliCatalog> = { en, "pt-BR": ptBR };
