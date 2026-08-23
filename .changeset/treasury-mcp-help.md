---
"@hasna/treasury": patch
---

treasury-mcp answers --help/-h before any transport (todos row 7e5f8f3d). Previously `treasury-mcp --help` fell through the --version guard and printed nothing (silent-empty family on help); --version already worked.
