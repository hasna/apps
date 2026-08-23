---
"@hasna/datasets": patch
---

datasets-mcp answers --version/-V before the stdio transport (todos row 7e5f8f3d). Previously `datasets-mcp --version` fell through the --help guard and printed nothing (silent-empty family on version).
