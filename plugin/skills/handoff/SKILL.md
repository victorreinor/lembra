---
name: handoff
description: Continues, in this conversation, the work of another Claude Code session using lembra's history. Use when the user types /lembra:handoff <session> or asks things like "continue session 3f2a", "pick up the context of that session", "resume what I did in the other terminal", "continua a sessão 3f2a", "retoma o que eu fiz no outro terminal".
---

# Session handoff

The argument is the start of a session id (e.g. `3f2a`) or the name given with `/rename`.

1. No argument: call `list_sessions` (MCP server `lembra`, limit 8), show the options numbered and ask which one to continue.
2. Call `handoff` with `session` set to the argument. If it reports more than one match, show them and ask.
3. Check the current state before acting: in the session's folder run `git status` and `git log -5 --oneline`, and read the relevant files it mentions. Use `get_file` for files deleted from disk.
4. Reply in at most 6 lines: the goal, where it stopped, what changed since then and the next step you propose.
5. If the user already asked you to continue, go ahead with that next step; otherwise wait for confirmation.

Do not paste the whole handoff back to the user; it is for you to regain the context. Always answer in the user's language.
