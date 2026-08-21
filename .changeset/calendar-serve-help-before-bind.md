---
"@hasna/calendar": patch
---

calendar-serve answers --help and --version before any port parse, serve import, or bind; previously `calendar-serve --help` fell through to the bind path and died with `calendar-serve: refusing to start — no serve credential is configured` (rc=1) instead of printing usage (BUG row dd27cac0).
