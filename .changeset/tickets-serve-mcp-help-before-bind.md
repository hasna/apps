---
"@hasna/tickets": patch
---

tickets-serve and tickets-mcp answer --help and --version before any bind or transport connect; previously `tickets-serve --help` fell through to serve() and either died at the bind with EADDRINUSE (port occupied, rc=1) or bound and served forever (rc=124 under timeout), and `tickets-mcp --version` entered MCP stdio mode, printed nothing, and exited rc=0 silently when stdin closed (todos row 5fcf7a67).
