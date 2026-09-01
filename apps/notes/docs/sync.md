# Hasna Notes single-server model

Multi-machine sync machinery was removed in 0.2.0. There is no sync daemon,
scheduled convergence, machine manifest, sync-state file, or `/api/v1/sync`
endpoint.

The current client model is intentionally smaller: the CLI, MCP server, and SDK
connect to one Notes server over the existing `personalnotes/v1` CRUD and export
API. Both `HASNA_NOTES_API_URL` and `HASNA_NOTES_API_KEY` are required, and the
URL must be HTTPS. Missing or partial configuration fails closed; there is no
local-store or localhost fallback.

The server may store its own data in SQLite or PostgreSQL. This is strictly a
server concern: clients reject `HASNA_NOTES_DATABASE_URL` and never open a
database directly.

The separate macOS product continues to live at
`hasna-products/personalnotes`. Its repository/product identity and the shared
`personalnotes/v1` wire name remain unchanged.
