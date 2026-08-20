---
"@hasna/test-guard": patch
---

Add --version and --help flags to sentinel.sh (task a6fc52c7). The flags short-circuit before any check, so a flag can never be mistaken for the positional bun-path argument again (this exact misparse posted two false [ALERT]s to #incidents on 2026-08-20). test/smoke.sh regresses both flags and asserts --version matches package.json.
