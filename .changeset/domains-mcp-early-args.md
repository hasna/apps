---
"@hasna/domains": patch
---

domains-mcp answers --help/--version before any bind; previously `domains-mcp --version` (and `--help`) fell through past the isStdioMode check to the shared Streamable HTTP server (default port 8859) — with the port occupied it died EADDRINUSE rc=1 printing nothing, with the port free it bound and hung instead of answering (todos row 46a45765).
