---
"@hasna/messages": patch
---

Every data command (`register`, `agents`, `whoami`, `send`, `receive`, `delivery`, `threads`, `thread`, `unread`, `read`, `close`, `reopen`) now accepts `--json` — output is already JSON, the flag just stops being rejected by commander's unknown-option handling (hasna/apps#1602).
