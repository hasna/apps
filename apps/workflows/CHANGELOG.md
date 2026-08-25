# @hasna/workflows

## 0.1.1

### Patch Changes

- Graph language (nodes, edges, while nodes with declared iteration bounds), run store with UNVERIFIED gate rows, session WAL, daemon, four lane adapters, and the complete 14-command CLI with authenticated trigger; live-verify closures (idempotent while-node crash recovery, foreground-run isolation); all surfaces answer --version/--help before any bind.

## 0.1.0

- Scaffold: the four surfaces (`workflows` CLI, `workflows-mcp` MCP server,
  `workflows-serve` HTTP server, `./sdk` importable module) with
  version/health/readiness on every surface. All three bins answer
  `--version`/`--help` before binding or serving.
