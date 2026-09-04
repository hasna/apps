---
"@hasna/messages": patch
---

Identity flags default from the station environment, and every data command
accepts `--json` (hasna/apps#1602).

- `--agent` / `--from` / `--name` are no longer mandatory: they resolve
  explicit flag → `HASNA_MESSAGES_AGENT_ID` → `MESSAGES_AGENT_ID` →
  `CONVERSATIONS_AGENT_ID`, and fail closed with an actionable error naming the
  flag and all three keys when none resolves. An explicit flag still wins, and
  a blank value is treated as absent rather than as an empty agent name.
- `register`, `agents`, `whoami`, `send`, `receive`, `delivery`, `threads`,
  `thread`, `unread`, `read`, `close` and `reopen` accept `--json` instead of
  rejecting it as an unknown option; the output was already JSON.
