# @hasna/workflows

## 0.1.4

### Patch Changes

- Fix-on-sight from the 2026-08-30 six-variant stress test (PRs #1485, #1486):
  - SQLite `database is locked` (SQLITE_BUSY) containment: finite `busy_timeout` + bounded retry in the store open path — concurrent CLI processes on one data dir no longer die with rc=1;
  - memo safety: graph-level `memoWatch` (files/globs under the data dir) joins the memo key via mtime+sha256 fingerprint, so a memoized command step cannot serve a value that contradicts a live run of the same command;
  - while-loop recording: every completed iteration owns its `run_nodes` row (`getLatestRunNode`), with retries/resumes still reusing non-completed rows;
  - cursor lane: SDK shape drift now surfaces as a clean `LaneAdapterShapeError` instead of a generic failed result;
  - daemon status: per-cycle counters persist in a versioned `{latestCycle, cumulative}` envelope (legacy flat reports read as baseline);
  - CLI `run -j`: failures emit JSON with `error` + `runId` on stdout (human message stays on stderr);
  - memoWatch: absolute glob patterns fingerprint matched files at their absolute paths (release-review P1) — a change under an absolute glob now invalidates memoized results instead of serving stale output.
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
