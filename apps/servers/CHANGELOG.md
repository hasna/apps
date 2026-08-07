# Changelog

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
