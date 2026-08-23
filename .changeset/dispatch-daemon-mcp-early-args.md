---
"@hasna/dispatch": patch
---

dispatch-daemon and dispatch-mcp answer --help and --version before any bind or transport connect; previously `dispatch-daemon --version` fell through to runDaemon() and claimPid, throwing "daemon already running (pid N)" wherever a daemon was live (or starting a real daemon on a free machine), and `dispatch-mcp --version` entered MCP stdio mode, printed nothing, and exited rc=0 silently when stdin closed (todos row 8a43ca44).
