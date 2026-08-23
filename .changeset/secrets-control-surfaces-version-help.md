---
"@hasna/secrets": patch
---

secrets, secrets-mcp, and secrets-serve answer --version/--help cleanly before any store resolution, transport connect, or bind (todos row afd9e358). Previously `secrets --version` exited rc=1 with "Unknown command: --version", `secrets-mcp --version` entered MCP stdio mode, printed nothing, and exited rc=0 silently when stdin closed, and `secrets-serve --version` fell through to the cloud-server boot path (master-key refusal rc=1, or bind-and-serve forever).
