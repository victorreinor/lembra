# Roadmap

✅ feito · 🚧 próxima · 💡 depois

## ✅ Fase 0: parar a perda

- [x] `cleanupPeriodDays: 3650` no `~/.claude/settings.json`
- [x] Backup completo de `~/.claude/projects` e `history.jsonl` antes de qualquer mudança

## ✅ Fase 1: indexador e CLI (v0.1)

- [x] Parser dos transcripts:
  - prompts humanos, inclusive os enviados durante o turno;
  - respostas e resumos do `/compact`;
  - títulos automáticos e o nome do `/rename`;
  - custo da sessão.
- [x] Indexação incremental por offset de bytes, tolerante a linhas pela metade
- [x] SQLite com FTS5: sem acento, por prefixo, frase exata e ranking bm25
- [x] Filtros por repo (nome do remote git), branch e data (absoluta, `01/10` ou relativa `7d`)
- [x] Cofre de arquivos:
  - Write com conteúdo completo;
  - Edit reconstruído;
  - Read fora do repo;
  - arquivos citados em prompts;
  - imagens coladas.
- [x] Importação do `history.jsonl` para sessões cujo transcript já foi apagado
- [x] Cópia bruta (zstd) de todos os transcripts, e `resume` que devolve transcripts apagados
- [x] `PARSER_VERSION`: reprocessamento automático, sem duplicar, quando o parser evolui
- [x] Comandos `search`, `list`, `show`, `resume`, `files`, `restore`, `cat`, `index` e `stats`
- [x] Testes unitários e de integração, typecheck strict e CI

## 🚧 Fase 2: interface e captura automática

- [ ] **`lembra ui`**: servidor local (`Bun.serve`, `localhost:4747`) com a página de busca. Segue **obrigatoriamente** o [docs/ui-guidelines.md](docs/ui-guidelines.md) (tokens CSS, componentes reutilizáveis, acessibilidade, atalhos de teclado)
  - [ ] Busca com filtros (repo, branch, período) e destaque das palavras encontradas
  - [ ] Detalhe da sessão: prompts, resumos, arquivos e custo
  - [ ] Ações: copiar `claude --resume`, abrir no Terminal (`osascript`), baixar ou restaurar arquivo
  - [ ] Instalável como app (manifest PWA, "Adicionar ao Dock" no Safari, "Instalar app" no Chrome)
- [ ] **API HTTP** reaproveitando `src/core` (a mesma que o MCP vai usar)
- [ ] **Captura automática** via plugin do Claude Code: hook `SessionEnd` roda `lembra index`; hook `PreCompact` faz um snapshot antes de compactar
- [ ] **`launchd`**: servidor sempre ligado e indexação diária como rede de segurança
- [ ] **`lembra install`**: configura tudo isso (link no PATH, hooks, `launchd`, retenção) e `lembra uninstall` desfaz
- [ ] Indexação em streaming. Hoje a primeira carga chega a cerca de 1,6 GB de memória por ler cada transcript inteiro

## 💡 Fase 3: o Claude consulta o próprio histórico

- [ ] **Servidor MCP** com as ferramentas `search_sessions`, `get_session` e `get_file`. Assim, "já fiz algo parecido?" vira uma pergunta normal para o Claude
- [ ] **`/handoff <sessão>`**: resumo pronto (objetivo, decisões, arquivos, próximos passos) para continuar em outro terminal
- [ ] **Resumos com IA** em lote via `claude -p --model haiku`, usando o login atual, sem chave de API
- [ ] **Trabalho inacabado**: sessões cuja branch nunca recebeu push ou não virou PR

## 💡 Ideias

- Relatório do dia e da semana por repo, pronto para daily ou reporte
- Custo por projeto e por semana (o dado já está no banco)
- Favoritos, tags e notas em sessões
- Exportar uma sessão em Markdown para compartilhar
- Mascarar segredos (tokens, senhas) na indexação
- Busca semântica com embeddings locais
- Extensão para Raycast e app de barra de menu
- Capturar arquivos gerados via Bash (redirect, heredoc)

## Limitações conhecidas

- Edits sem `originalFile` e sem versão anterior conhecida ficam registrados sem conteúdo ("sem conteúdo completo").
- Arquivos citados em prompts antigos são copiados no momento da indexação e podem ter mudado desde o prompt.
- Sessões vindas só do `history.jsonl` não têm branch, respostas nem arquivos.
- Imagens lidas pelo Read não entram no cofre, porque o resultado da ferramenta não traz o caminho.
- Testado em macOS. Linux deve funcionar (o CI roda nele); Windows não foi testado.
