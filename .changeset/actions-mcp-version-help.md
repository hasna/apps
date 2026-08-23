---
"@hasna/actions": patch
---

actions-mcp answers --version/-V/--help before the stdio transport (todos row 7e5f8f3d). Previously `actions-mcp --version`/`--help` fell into the transport connect and printed nothing (silent-empty family).
