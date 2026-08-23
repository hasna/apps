---
"@hasna/instructions": patch
---

instructions-mcp/configs-mcp answer --version/-V/--help before any bind (todos row 7e5f8f3d). Previously `configs-mcp --version`/`--help` fell through to the shared Streamable HTTP server and bound :8853 with no output.
