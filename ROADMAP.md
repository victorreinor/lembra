# Roadmap

✅ feito · 🚧 próxima · 💡 depois

## ✅ Fase 0: parar a perda

- [x] `cleanupPeriodDays: 3650` no `~/.claude/settings.json`
- [x] Backup completo de `~/.claude/projects` e `history.jsonl` antes de qualquer mudança

## ✅ Fase 1: indexador e CLI (v0.1)

- [x] Parser dos transcripts: prompts humanos (inclusive os enviados durante o turno), respostas, resumos do `/compact`, títulos automáticos, `/rename` e custo
- [x] Indexação incremental por offset de bytes, em blocos de 8 MB, tolerante a linhas pela metade
- [x] SQLite FTS5: sem acento, por prefixo, frase exata, ranking bm25
- [x] Filtros por repo (remote git), branch e data (`2026-10-01`, `01/10`, `7d`)
- [x] Cofre de arquivos: Write completo, Edit reconstruído, Read fora do repo, arquivos citados em prompts e imagens coladas
- [x] Importação do `history.jsonl` para sessões cujo transcript já foi apagado
- [x] Cópia bruta (zstd, em streaming) de todos os transcripts e `resume` que devolve transcripts apagados
- [x] `PARSER_VERSION`: reprocessamento automático, sem duplicar, quando o parser evolui

## ✅ Fase 2: página e captura automática (v0.2)

- [x] `lembra ui`: servidor local (`Bun.serve`, `127.0.0.1:4747`) com a página de busca, seguindo o [guia de UI](docs/ui-guidelines.md)
- [x] API local reaproveitando `src/core`, com proteção contra DNS rebinding e CSRF
- [x] Ações: retomar no Terminal, copiar comando e handoff, ver, baixar e restaurar arquivos
- [x] Instalável como app (manifest PWA, ícones)
- [x] Plugin do Claude Code: hooks `SessionEnd` e `PreCompact` rodam `lembra hook`
- [x] `launchd`: página sempre ligada e indexação diária às 12:30
- [x] `lembra install` / `uninstall`, idempotentes e com `--dry-run`

## ✅ Fase 3: o Claude consulta o próprio histórico (v0.2)

- [x] Servidor MCP sem dependências com as ferramentas `search_history`, `list_sessions`, `get_session`, `handoff`, `list_files`, `get_file` e `pending_work`
- [x] `/lembra:handoff <sessão>` e a skill de histórico
- [x] `lembra summarize`: resumos com `claude -p --model haiku --no-session-persistence`, pesquisáveis
- [x] `lembra pending`: branches sem push, com commits sem push, sujas ou sem PR

## ✅ Internacionalização (v0.3)

- [x] Português do Brasil e inglês em toda a interface, nos erros, no handoff, nos resumos e no MCP
- [x] `lembra lang`, `--lang`, `LEMBRA_LANG` e seletor PT/EN na página
- [x] Catálogos tipados: chave faltando é erro de compilação ([docs/i18n.md](docs/i18n.md))

## ✅ Segredos e telas pequenas (v0.3)

- [x] Mascaramento de segredos no índice (busca, página, handoff, MCP, resumos), com migração automática do banco existente
- [x] Arquivos com segredos sinalizados e mascarados quando lidos pelo Claude via MCP; restore continua byte a byte
- [x] Layout de celular conferido em 390 px: cabeçalho, abas e filtros empilham sem estouro horizontal

## 💡 Próximas ideias

- [ ] Relatório do dia e da semana por repo, pronto para daily ou reporte
- [ ] Custo por projeto e por semana (o dado já está no banco)
- [ ] Favoritos, tags e notas em sessões
- [ ] Exportar uma sessão em Markdown
- [ ] Busca semântica com embeddings locais
- [ ] Extensão do Raycast e app de barra de menu
- [ ] Capturar arquivos gerados via Bash (redirect, heredoc)
- [ ] Serviços em segundo plano no Linux (systemd `--user`)
- [ ] Mais idiomas (espanhol é o próximo candidato natural)
- [ ] Rodar resumos automaticamente (opt-in) na indexação diária

## Limitações conhecidas

- Edits sem `originalFile` e sem versão anterior conhecida ficam registrados sem conteúdo ("sem conteúdo completo").
- Arquivos citados em prompts antigos são copiados no momento da indexação e podem ter mudado desde o prompt.
- Sessões vindas só do `history.jsonl` não têm branch, respostas nem arquivos, e não podem ser retomadas (só via handoff).
- Imagens lidas pelo Read não entram no cofre, porque o resultado da ferramenta não traz o caminho.
- "Abrir no Terminal" usa o Terminal.app; iTerm e outros ainda não.
- O layout de celular foi conferido num viewport emulado de 390 px, não num aparelho físico.
- O mascaramento usa padrões conhecidos (tokens com prefixo, variáveis com nome de segredo, URLs com senha); um segredo sem formato reconhecível, colado solto no texto, passa.
- A primeira indexação de ~2,5 GB chega a ~750 MB de memória; as seguintes são incrementais e leves.
- Testado em macOS. O CI roda em Linux; Windows não foi testado.
