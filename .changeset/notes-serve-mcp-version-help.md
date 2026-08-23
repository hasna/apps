---
"@hasna/notes": patch
---

notes-serve answers --version/-V before any bind, and notes-mcp answers --version/-V/--help before the stdio framing loop (todos row 7e5f8f3d). Previously `notes-serve --version` bound :8788 with no output, and `notes-mcp --version`/`--help` printed nothing (silent-empty family).
