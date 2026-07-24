# Changelog

## 0.1.22

- Publish the compact CLI and MCP list output landed in #1: `servers`, `agents`,
  and `operations` list commands now default to a compact, paginated table
  (opt-in extra columns via `--verbose`, full data via `--json`), with a
  `<resource>:get <id>` detail path and `--cursor` pagination hints.
- Tests: give the two subprocess-heavy CLI integration tests (compact list
  pagination for servers and operations, each spawning 25+ cold CLI processes)
  an explicit 60s per-test timeout so they no longer flake under the default
  5s `bun:test` timeout on loaded machines.
