---
"@hasna/accounts": patch
---

fix(accounts): the statusline provisioner never persists a shell-expandable command. Fresh Claude profiles are born with the installed `statusline` binary when the machine declares no statusLine, but the resolved binary path is validated before it is quoted-and-stored: a PATH entry whose name carries `$()`, backticks, `$VAR`, embedded quotes, or backslashes (P1 command injection, successor lane to hasna/apps#272) is refused rather than persisted into `statusLine.command`, which the tool executes through a shell at status refresh.
