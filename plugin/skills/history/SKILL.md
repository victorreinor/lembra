---
name: history
description: Searches the full history of Claude Code sessions on this computer (every folder and repository, including old sessions Claude Code already deleted) and the files generated in them. Use when the user asks "have I done something like this before?", "search my history", "that session where…", "the SQL you generated last week", "what did I do yesterday in repo X", "what is still pending", or asks for a file that disappeared — in any language (e.g. "já fiz algo parecido?", "procura no meu histórico").
---

# Claude Code history

Tools of the `lembra` MCP server:

| Question | Tool |
|---|---|
| "Have I done something like this?", "find X" | `search_history` with 1 to 3 keywords (prefixes match: `bill` finds `billing`) |
| "What did I do yesterday / in repo X?" | `list_sessions` with `since` (`1d`, `7d`) and/or `repo` |
| Details of a session found | `get_session` (use `include_replies` only if you need Claude's answers) |
| Continue that work | `handoff` |
| "The SQL / file you generated" | `list_files` (e.g. `term: ".sql"`, `missing: true`) and `get_file` |
| "What is still pending?" | `pending_work` |

How to work:

1. Start broad and narrow down: a few words first, then `repo`, `branch` or `since` filters. Search with the words the user would have used, in their language.
2. Cite sessions by their short id (first 8 characters), with date and repo, so the user recognizes them.
3. To reopen a session in its original conversation, give the command `cd <folder> && claude --resume <id>`. To bring its context here, use `handoff`.
4. To put a file back on disk, suggest `lembra restore <id>` (or `--to <folder>`).
5. If nothing is found, say so plainly and suggest other words. Never invent sessions.

Always answer in the user's language.
