---
"@hasna/tai": patch
---

tai-mcp answers --version/-V/--help before the readline transport (todos row 7e5f8f3d). Previously `tai-mcp --version`/`--help` fell into the readline loop and printed nothing (silent-empty family).
