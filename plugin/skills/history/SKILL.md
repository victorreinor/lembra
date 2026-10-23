---
name: history
description: Consulta o histórico completo de sessões do Claude Code deste computador (todas as pastas e repositórios, inclusive sessões antigas apagadas pelo Claude Code) e os arquivos gerados nelas. Use quando o usuário perguntar "já fiz algo parecido?", "procura no meu histórico", "naquela sessão em que…", "o SQL que você gerou semana passada", "o que eu fiz ontem no repo X", "o que ficou pendente", ou pedir um arquivo que sumiu.
---

# Histórico do Claude Code

Ferramentas do servidor MCP `lembra`:

| Pergunta | Ferramenta |
|---|---|
| "Já fiz algo parecido?", "procura X" | `search_history` com 1 a 3 palavras-chave (prefixos casam: `fatur` acha `faturamento`) |
| "O que eu fiz ontem / no repo X?" | `list_sessions` com `since` (`1d`, `7d`) e/ou `repo` |
| Detalhes de uma sessão encontrada | `get_session` (use `include_replies` só se precisar das respostas) |
| Continuar aquele trabalho | `handoff` |
| "O SQL / arquivo que você gerou" | `list_files` (ex.: `term: ".sql"`, `missing: true`) e `get_file` |
| "O que ficou pendente?" | `pending_work` |

Como trabalhar:

1. Comece amplo e afunile: poucas palavras primeiro, depois filtros de `repo`, `branch` ou `since`.
2. Cite as sessões pelo id curto (8 primeiros caracteres), com data e repo, para o usuário reconhecer.
3. Para retomar uma sessão na própria conversa original, informe o comando `cd <pasta> && claude --resume <id>`. Para trazer o contexto para cá, use `handoff`.
4. Para devolver um arquivo ao disco, sugira `lembra restore <id>` (ou `--to <pasta>`).
5. Se nada for encontrado, diga isso claramente e sugira outras palavras. Não invente sessões.
