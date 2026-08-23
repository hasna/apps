---
"@hasna/loops": patch
---

loops-mcp answers --version/-V/--help before any bind (todos row 7e5f8f3d). Previously `loops-mcp --version`/`--help` fell through to the shared Streamable HTTP server and bound :8890 with no output.
