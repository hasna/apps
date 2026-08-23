---
"@hasna/bridge": patch
---

bridge-mcp answers --version/-V/--help before the stdio transport connect (todos row 7e5f8f3d). Previously `bridge-mcp --version`/`--help` fell into the module-top transport connect and printed nothing (silent-empty family).
