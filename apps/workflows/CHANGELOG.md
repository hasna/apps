# @hasna/workflows

## 0.1.3

### Patch Changes

- Switch local path reads/writes through the `@hasna/paths` resolver (XDG/macOS home layout). The legacy `~/.hasna/workflows` default (with the `HASNA_WORKFLOWS_DATA_DIR` / `WORKFLOWS_DATA_DIR` overrides) stays the effective data home until the store is migrated to the XDG data home (`workflows.db` exists there) or `HASNA_DATA_HOME` is set. Dependency pinned exactly to `@hasna/paths@0.1.0` (XDG home migration, hotfixes plan 0f49f56a, task P3.3).

## 0.1.2

### Patch Changes

- Republish of the 0.1.1 artifact with corrected package metadata: engines now declare Bun only, matching the bun-targeted build (`bun:sqlite`). No source changes since 0.1.1.

## 0.1.1

### Patch Changes

- Graph language (nodes, edges, while nodes with declared iteration bounds), run store with UNVERIFIED gate rows, session WAL, daemon, four lane adapters, and the complete 14-command CLI with authenticated trigger; live-verify closures (idempotent while-node crash recovery, foreground-run isolation); all surfaces answer --version/--help before any bind.

## 0.1.0

- Scaffold: the four surfaces (`workflows` CLI, `workflows-mcp` MCP server,
  `workflows-serve` HTTP server, `./sdk` importable module) with
  version/health/readiness on every surface. All three bins answer
  `--version`/`--help` before binding or serving.
