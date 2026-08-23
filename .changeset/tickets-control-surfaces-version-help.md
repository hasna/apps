---
"@hasna/tickets": patch
---

tickets-serve and tickets-mcp answer --help/--version cleanly before any bind or transport connect (todos row 5fcf7a67). Previously `tickets-serve --help`/`--version` fell through to serve() and bound the port (EADDRINUSE when occupied, or bind-and-serve forever), and `tickets-mcp --version`/`--help` entered MCP stdio mode, printed nothing, and exited rc=0 silently when stdin closed.
