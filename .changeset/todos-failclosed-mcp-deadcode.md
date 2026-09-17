---
"@hasna/todos": minor
---

MCP surface triage, slice 1 (fleet alignment 2026-09-11; follows the fail-closed
validation in #1942).

- `todos-mcp` is stdio-only. `--http`, `--port <n>` and `MCP_HTTP=1` are refused
  with exit code 2 and a stderr line pointing at `todos-serve`, which owns the
  `POST /mcp` Streamable HTTP endpoint and its auth posture. The MCP bin used to
  start the full `todos-serve` HTTP app with `allowAnonymous: true` from a client
  binary that MCP clients spawn with no credential.
- Removed 50 files under `src/mcp/tools/` that the server never registered
  (nothing imported 48 of them; `todos-md.ts` was reached only by its own test),
  plus `code-tools.ts`: the `extract_todos` and `watch_source_todos` MCP tools are
  gone (a polling filesystem watcher is not an MCP tool call, and the scan reads
  the agent host's checkout, not the hosted fleet). `todos extract` /
  `todos extract-watch` remain as CLI verbs; the CLI↔MCP parity manifest records
  the `source-index` domain as an intentional gap.
- `todos stream` defaults to the `todos serve` port (19427) instead of 3000, a
  port nothing in this package listens on.
