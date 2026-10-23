# lembra: guia para agentes

`lembra` indexa os arquivos locais do Claude Code (`~/.claude`) num SQLite com FTS5 e oferece uma CLI, uma página local, um servidor MCP e um plugin do Claude Code para buscar sessões, restaurar arquivos e continuar trabalhos. É Bun + TypeScript strict, com interface em inglês e português do Brasil.

## Leia conforme a tarefa

| Tarefa | Leia |
|---|---|
| Entender o produto, instalar, usar | [README.md](README.md) ([English](README.en.md)) |
| Saber o que está feito, o que vem depois e as limitações | [ROADMAP.md](ROADMAP.md) |
| Mexer em indexação, busca, schema, API, MCP, plugin ou instalação | [docs/architecture.md](docs/architecture.md) |
| Mexer no parser (`src/core/transcript.ts`) | [docs/claude-code-data.md](docs/claude-code-data.md) |
| Criar ou alterar a página | [docs/ui-guidelines.md](docs/ui-guidelines.md), que é obrigatório |
| Adicionar ou alterar qualquer texto que o usuário vê, ou um idioma | [docs/i18n.md](docs/i18n.md) |

## Comandos

```bash
bun test                    # unit + integração + componentes (< 1 s)
bun test test/unit          # só unitários
bun run typecheck           # tsc --noEmit, strict
bun run demo                # página com dados fictícios em localhost:4848 (para UI e screenshots)
bun src/cli/index.ts <args> # roda a CLI sem instalar
LEMBRA_HOME=/tmp/l CLAUDE_CONFIG_DIR=/tmp/c bun src/cli/index.ts index   # sandbox, sem tocar nos dados reais
```

## Mapa do código

```text
src/core/            regras e dados; sem console, sem process.exit, sem texto fixo de idioma
  transcript.ts      parser puro de uma linha JSONL (PARSER_VERSION)
  indexer.ts         varre ~/.claude, leitura incremental em blocos, grava sessões/mensagens/arquivos
  archive.ts         cópia zstd (streaming) dos transcripts; restauração para o resume
  db.ts              schema SQLite + FTS5 + colunas adicionadas depois
  query.ts           filtros, datas, montagem da query FTS
  search.ts          busca ranqueada por sessão
  sessions.ts        listar, achar e descrever sessões; facetas
  files.ts           consultar e restaurar arquivos do cofre
  handoff.ts         resumo de passagem em Markdown (por idioma)
  summarize.ts       resumos com claude -p (Runner injetável)
  pending.ts         branches com trabalho não entregue (GitProbe injetável)
  errors.ts          LembraError(código, parâmetros), renderizado por idioma
  text.ts            textFormat(locale): datas, tamanhos, números
  config.ts, stats.ts, repo.ts, blobs.ts, services.ts, paths.ts
src/i18n/            catálogos (errors, core, cli, mcp, ui) com en e pt-BR lado a lado; locale.ts, system.ts
src/cli/             main.ts (argumentos, idioma, despacho), commands.ts (um handler por comando), format.ts (cores)
src/web/             api.ts (HTTP), server.ts (Bun.serve + página), types.ts (DTOs)
  ui/                app.ts, lib/ (dom, api, state, i18n, format, keyboard, icons), components/<nome>/, styles/
src/mcp/             server.ts (JSON-RPC via stdio), tools.ts (ferramentas)
src/system/          os.ts (clipboard, Terminal, navegador), install.ts (PATH, retenção, plugin, launchd)
plugin/              plugin do Claude Code: hooks/hooks.json, .mcp.json, skills/
scripts/demo.ts      ~/.claude fictício + página
test/                unit/, integration/, web/ (happy-dom), support/fixture.ts
```

## Regras do projeto

- `src/core` nunca escreve no terminal nem tem frases fixas. Ele devolve dados ou lança `LembraError("codigo", { params })`, e cada interface traduz.
- **Nenhum texto para o usuário fora de `src/i18n`.** Toda frase nova entra no catálogo em inglês e em português; o TypeScript acusa o que faltar.
- Texto para o modelo (descrições de ferramentas MCP, skills) fica em inglês e pede que o Claude responda no idioma do usuário.
- Código, nomes e comentários em inglês. Os docs do projeto ficam em português, exceto o `README.en.md`.
- Mudou o que o parser extrai? Incremente `PARSER_VERSION` e documente em `docs/claude-code-data.md`.
- Schema só aditivo: `CREATE … IF NOT EXISTS` ou `ADDED_COLUMNS` em `db.ts`. O banco é descartável (`rm -rf ~/.lembra && lembra index`).
- Efeitos fora do cofre (git, gh, claude, launchctl, osascript) passam por interfaces injetáveis (`Services`, `InstallEnv.exec`). Os testes nunca chamam essas ferramentas de verdade.
- Toda feature precisa de teste unitário da parte pura e de integração com `test/support/fixture.ts`. Componentes novos precisam de teste em `test/web`.
- **O repositório é público.** Nada de transcripts reais, nomes de clientes, caminhos pessoais ou segredos em fixtures, docs, exemplos ou screenshots (use `bun run demo`).
- Antes de concluir: `bun run typecheck && bun test`.
