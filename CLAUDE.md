# lembra: guia para agentes

`lembra` indexa os arquivos locais do Claude Code (`~/.claude`) num SQLite com FTS5 e oferece uma CLI para buscar sessões, restaurar arquivos e retomar conversas. É Bun + TypeScript strict, sem dependências de runtime.

## Leia conforme a tarefa

| Tarefa | Leia |
|---|---|
| Entender o produto, instalar, usar | [README.md](README.md) |
| Saber o que está feito, o que vem depois e as limitações | [ROADMAP.md](ROADMAP.md) |
| Mexer em indexação, busca, schema ou cofre | [docs/architecture.md](docs/architecture.md) |
| Mexer no parser (`src/core/transcript.ts`) | [docs/claude-code-data.md](docs/claude-code-data.md) |
| Criar ou alterar qualquer interface (Fase 2) | [docs/ui-guidelines.md](docs/ui-guidelines.md), que é obrigatório |

## Comandos

```bash
bun test                    # unit + integração (rápido, < 1 s)
bun test test/unit          # só unitários
bun run typecheck           # tsc --noEmit, strict
bun src/cli/index.ts <args> # roda a CLI sem instalar
LEMBRA_HOME=/tmp/l CLAUDE_CONFIG_DIR=/tmp/c bun src/cli/index.ts index   # sandbox, sem tocar nos dados reais
```

## Mapa do código

```text
src/core/            regras e dados, sem console nem process.exit
  transcript.ts      parser puro de uma linha JSONL → mensagens, arquivos, títulos (PARSER_VERSION)
  indexer.ts         varre ~/.claude, leitura incremental, grava sessões/mensagens/arquivos
  archive.ts         cópia zstd dos transcripts e restauração para o resume
  db.ts              schema SQLite (+ FTS5 e triggers)
  query.ts           filtros, datas e a montagem da query FTS
  search.ts          busca ranqueada por sessão
  sessions.ts        listar, achar e descrever sessões
  files.ts           consultar e restaurar arquivos do cofre
  blobs.ts           armazenamento por hash (sha256 + zstd)
  repo.ts            pasta → nome do repositório (remote git)
  stats.ts           números do cofre e da retenção
  paths.ts, errors.ts
src/cli/
  index.ts           bin (shebang), só chama run()
  main.ts            parse de argumentos, despacho, refresh automático do índice
  commands.ts        um handler por comando, escrevendo via Io injetado
  format.ts, help.ts
test/
  unit/              funções puras
  integration/       indexer, search e CLI sobre um ~/.claude falso
  support/fixture.ts builders de registros no formato real do Claude Code
```

## Regras do projeto

- `src/core` nunca escreve no terminal. Ele retorna dados ou lança `LembraError` com uma mensagem pronta para o usuário.
- `src/cli` só traduz argumentos e formata. Cada comando recebe `Io`, então os testes chamam `run(argv, io, paths)` sem subprocesso.
- Texto para o usuário vai em **português do Brasil**. Código, nomes e comentários vão em inglês.
- Se você mudar o que o parser extrai, incremente `PARSER_VERSION` em `src/core/transcript.ts` (o índice é reprocessado sem duplicar) e documente o formato em `docs/claude-code-data.md`.
- Mudanças de schema são só aditivas: `CREATE … IF NOT EXISTS` ou colunas novas. O banco é descartável: `rm -rf ~/.lembra && lembra index` reconstrói tudo.
- Toda feature precisa de um teste unitário para a parte pura e um de integração usando `test/support/fixture.ts`.
- **O repositório é público.** Nunca use transcripts reais, nomes de clientes, caminhos pessoais ou segredos em fixtures, docs ou exemplos.
- Antes de concluir qualquer tarefa, rode `bun run typecheck && bun test`.
