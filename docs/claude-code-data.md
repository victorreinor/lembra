# Formato dos dados do Claude Code

Referência do que o parser (`src/core/transcript.ts`) lê. O formato não é documentado oficialmente; tudo aqui foi verificado em arquivos reais do **Claude Code 2.1.309** (outubro de 2026). Se algo mudar, atualize este arquivo, os builders em `test/support/fixture.ts` e incremente `PARSER_VERSION`.

## Onde ficam os arquivos

| Caminho | Conteúdo |
|---|---|
| `~/.claude/projects/<pasta-codificada>/<sessionId>.jsonl` | Transcript completo de uma sessão. A pasta codificada é o `cwd` com `/` trocado por `-` |
| `~/.claude/projects/<pasta>/<sessionId>/subagents/agent-<id>.jsonl` | Transcript de cada subagente da sessão |
| `~/.claude/history.jsonl` | Um registro por prompt digitado, de todas as sessões. Fica guardado bem mais tempo que os transcripts |
| `~/.claude/settings.json` → `cleanupPeriodDays` | Dias de retenção dos transcripts, contados a partir da última atividade. O padrão é 30 |

`CLAUDE_CONFIG_DIR` muda a raiz `~/.claude`.

## Transcript: um objeto JSON por linha

O campo `type` define o registro. Muitos começam com `{"type":"…"`, e o `shouldParse` usa isso para pular registros de controle sem fazer o parse.

| `type` | Usado? | Campos relevantes |
|---|---|---|
| `user` | ✅ | `uuid`, `timestamp`, `sessionId`, `cwd`, `gitBranch`, `message.content`, `isMeta`, `isSidechain`, `isCompactSummary`, `origin`, `promptSource`, `turnOrigin`, `toolUseResult` |
| `assistant` | ✅ | `uuid`, `timestamp`, `message.content[]` (blocos `text`, `thinking`, `tool_use`), `isSidechain` |
| `attachment` | ✅ (só `queued_command`) | `attachment.type`, `attachment.prompt`, `attachment.commandMode`, `attachment.origin` |
| `ai-title` | ✅ | `aiTitle`, o título automático. É reescrito ao longo da sessão e vale o último |
| `custom-title` | ✅ | `customTitle`, o nome dado com `/rename` |
| `cost-state` | ✅ | `totalCostUSD`, `totalLinesAdded`, `totalLinesRemoved` (acumulados; vale o último) |
| `last-prompt`, `mode`, `permission-mode`, `atis-latch`, `file-history-snapshot`, `api-request*`, `system`, `queue-operation` | ❌ | Controle interno |

### O que conta como prompt humano

Um registro `user` é prompt quando:

- não tem bloco `tool_result` no conteúdo (esses são resultados de ferramentas);
- não tem `isMeta` nem `isSidechain`;
- `promptSource` não é `system`;
- `turnOrigin`, quando existe, é `human`;
- `origin.kind`, quando existe, é `human`. Os outros valores vistos são `task-notification`, `coordinator`, `peer` e `auto-continuation`;
- depois do `normalizePrompt`, sobra texto.

Registros antigos não têm `origin`, `promptSource` nem `turnOrigin`, e são tratados como humanos.

`normalizePrompt` faz o seguinte:

- remove blocos `<system-reminder>`;
- descarta `<local-command-stdout|stderr|caveat>`, `Caveat: The messages below…` e `[Request interrupted…`;
- converte `<command-name>/x</command-name><command-args>a</command-args>` em `/x a`;
- tira as tags `<pasted_content …>`, mantendo o texto colado.

`isCompactSummary: true` marca o resumo gerado pelo `/compact`, que é indexado com papel `summary`.

### Mensagens enviadas durante o turno

O que o usuário digita enquanto o Claude ainda está trabalhando não vira registro `user`. Vira um `attachment`:

```json
{"type":"attachment","uuid":"…","timestamp":"…","attachment":{"type":"queued_command","prompt":"qualquer coisa me pergunta","commandMode":"prompt","origin":{"kind":"human"},"humanTurn":true}}
```

Só entra `commandMode` igual a `prompt` com origem humana.

### Imagens coladas

Bloco do conteúdo do usuário: `{"type":"image","source":{"type":"base64","media_type":"image/png","data":"…"}}`.

### Resultados de ferramentas (`toolUseResult`)

Ficam no registro `user` que tem o bloco `tool_result`. O `tool_use_id` desse bloco é usado como `uid` da operação de arquivo.

| Ferramenta | Formato |
|---|---|
| Write | `{ type: "create" \| "update", filePath, content, structuredPatch, originalFile }`. O `content` é o arquivo inteiro |
| Edit | `{ filePath, oldString, newString, replaceAll, originalFile, structuredPatch, userModified }`. O `originalFile` é o arquivo inteiro antes da edição e vem preenchido em cerca de metade dos casos |
| Read (texto) | `{ type: "text", file: { filePath, content, numLines, startLine, totalLines } }`. Só é completo quando `startLine` é 1 e `numLines` é igual a `totalLines` |
| Read (imagem) | `{ type: "image", file: { base64, type, originalSize, dimensions } }`. Não traz o caminho, por isso não é capturado |

Em caso de erro, o `toolUseResult` pode ser uma string. Nesse caso é ignorado.

### Subagentes

Os registros nos arquivos `subagents/` têm `isSidechain: true`, o `sessionId` da sessão pai e um `agentId`. O `lembra` aproveita deles só as operações de arquivo, atribuídas à sessão pai.

## `history.jsonl`

```json
{"display":"[Pasted text #1 +20 lines] explica","pastedContents":{"1":{"id":1,"type":"text","content":"…"}},"timestamp":1773180231478,"project":"/Users/me/projects/app","sessionId":"…"}
```

- `timestamp` em milissegundos.
- `project` é o `cwd`.
- `display` é o que foi digitado, com marcadores de colagem. O conteúdo colado fica em `pastedContents`.
- Não traz branch, respostas nem arquivos.
