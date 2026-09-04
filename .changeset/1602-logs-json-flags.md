---
"@hasna/logs": patch
---

`logs list --json` and `logs get --json` are now accepted as aliases of `--format json`, so scripts passing `--json` on list/read surfaces no longer trip commander's unknown-option rejection (hasna/apps#1602).
