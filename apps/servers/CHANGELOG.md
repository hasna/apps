# Changelog

## 0.1.26

### Patch Changes

- c266577: Switch @hasna/servers local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The default SQLite database path (`src/db/database.ts` fallback) now resolves from the effective data root: the resolver data home (`~/.local/share/hasna/servers` on Linux, `~/Library/Application Support/Hasna/servers` on macOS) is adopted only when the operator sets the data-kind override `HASNA_DATA_HOME` or the store has already been physically migrated there — the legacy `~/.hasna/servers` root stays the effective data home until then, so an existing local store never becomes invisible on upgrade. The pre-existing `SERVERS_DB_PATH` store override and the per-project `.servers/servers.db` discovery keep their precedence above the default. The dependency is pinned exactly to `@hasna/paths@0.1.0` — the wave-wide pin for the hasna/apps resolver-switch lanes (XDG home migration, hotfixes plan 0f49f56a, task P3.3).
- Updated dependencies [8e7403f]
- Updated dependencies [94e6de9]
  - @hasna/events@0.1.18
  - @hasna/paths@0.2.3

## 0.1.25

### Patch Changes

- Switch the default SQLite database path through the `@hasna/paths` resolver (XDG/macOS home layout): the legacy `~/.hasna/servers` data root stays the effective default until the resolver data home is adopted (operator sets `HASNA_DATA_HOME` or the store is already physically migrated there), so an existing local store never becomes invisible on upgrade. The `SERVERS_DB_PATH` store override and the per-project `.servers/servers.db` discovery keep their precedence. Dependency pinned exactly to `@hasna/paths@0.1.0` (hotfixes plan 0f49f56a, task P3.3).

## 0.1.24

### Patch Changes

- 2ea3b9a: fix: packed tarballs no longer carry account-id-shaped 12-digit runs (publish-guard pattern aws-account-id, row 27d2a7a2). The carries were bundled dependency constants — zod's nil-UUID regex (v4/core/regexes.js), pg-types' binary-parser date offset, and the workspace @hasna/contracts bundle — plus one own-source nil-UUID literal in testers. Fixes: externalize zod/pg/@hasna/contracts in the member builds (each remains a declared runtime dependency, so runtime behavior is unchanged), build testers' nil UUID at runtime, and add a per-member publish-guard regression that packs the tarball and scans it with the guard's pattern set (red before, green after).

## Unreleased

## 0.1.23

- Fix `traces --server` silently returning nothing for a short ID or slug (#10).
  `traces.server_id` stores the full UUID, so the 8-character ID that the servers
  table itself renders — the value a reader copies off the screen — matched
  nothing and printed `Showing 0.` at rc=0 with empty stderr. That output was
  byte-identical to a server with no traces and to an identifier that does not
  exist, so callers concluded "no audit trail" while entries existed. The option
  now resolves through the same id-or-slug resolver the other verbs use, so full
  UUID, short ID, slug and name all work, and an unknown identifier exits
  non-zero with `Server not found` instead of printing an empty table at rc=0.
- Align the package with `@hasna/contracts`: add `hasna.contract.json`, a
  contract conformance test, and a publish-time artifact scan (#6).
- Add reference documentation for the CLI, MCP surface, database, and runtime (#5).
- Add GitHub Actions CI for pull requests and pushes to `main`, covering frozen
  dependency installation, typechecking, builds, and tests (#9).
- Add `.editorconfig` for consistent formatting (#8).

## 0.1.22

- Publish the compact CLI and MCP list output landed in #1: `servers`, `agents`,
  and `operations` list commands now default to a compact, paginated table
  (opt-in extra columns via `--verbose`, full data via `--json`), with a
  `<resource>:get <id>` detail path and `--cursor` pagination hints.
- Tests: give the two subprocess-heavy CLI integration tests (compact list
  pagination for servers and operations, each spawning 25+ cold CLI processes)
  an explicit 60s per-test timeout so they no longer flake under the default
  5s `bun:test` timeout on loaded machines.
