---
"@hasna/attachments": patch
---

`attachments list --json` is now accepted as an alias of `--format json`, so scripts passing `--json` on the list surface no longer trip commander's unknown-option rejection (hasna/apps#1602).
