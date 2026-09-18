---
"@hasna/todos": patch
---

Bound MCP and CLI task listing to 50 rows by default, preserve authority totals/caps/offsets and snapshot cursors from one paged response, report legacy completeness as unknown instead of guessing, and require explicit `--all` for exhaustion under 5,000-row and measured 1 MiB pretty-output ceilings.
