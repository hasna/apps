# Changelog

## 0.1.15

- Publish the compact CLI/MCP output feature merged in PR #1: list/status/detail
  CLI commands and MCP tools are now compact by default with bounded rows,
  truncation, pagination (`--limit`/`--cursor`/`nextCursor`), `--verbose`, and
  explicit `--json` full-output paths. Adds compact summary MCP resources
  (`styles://registry/summary`, `styles://summary/{name}`) alongside full-detail
  compatibility resources, plus `format.ts` helpers and README guidance.
  (Version bump only; source already on `main` via #1.)

## 0.1.14

- Clean styles package bin metadata; tighten release gate; remove cloud
  dependency; report package version; migrate legacy data dirs; prevent template
  output path escapes; resolve built-in active profile refs.
