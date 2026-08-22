---
"@hasna/calendar": patch
---

calendar-mcp answers --help/-h and --version/-V with rc=0 before any http-mode parse, server build, or stdio bind; previously `calendar-mcp --version` entered the stdio JSON-RPC loop and hung (rc=124 under timeout, 0 bytes stdout) instead of printing the version (BUG row 06003b88). Mirrors the serve bin's early-args handling (dd27cac0) in the mcp entry.
