---
name: handoff
description: Continua nesta conversa o trabalho de outra sessão do Claude Code, usando o histórico do lembra. Use quando o usuário digitar /lembra:handoff <sessão> ou pedir "continua a sessão 3f2a", "pega o contexto daquela sessão", "retoma o que eu fiz no outro terminal", "segue de onde parou".
---

# Handoff de sessão

O argumento é o começo do id da sessão (ex.: `3f2a`) ou o nome dado com `/rename`.

1. Sem argumento: chame `list_sessions` (servidor MCP `lembra`, limit 8), mostre as opções numeradas e pergunte qual continuar.
2. Chame `handoff` com `session` igual ao argumento. Se vier "ambíguo", mostre as opções e pergunte.
3. Confira o estado atual antes de agir: na pasta da sessão, rode `git status` e `git log -5 --oneline`, e leia os arquivos citados que forem relevantes. Use `get_file` para os que foram apagados do disco.
4. Responda em até 6 linhas: objetivo, onde parou, o que mudou desde então e o próximo passo que você propõe.
5. Se o usuário já pediu para continuar, siga com o próximo passo. Caso contrário, espere a confirmação.

Não repita o handoff inteiro para o usuário; ele serve para você retomar o contexto.
