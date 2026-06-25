# Compact CLI and MCP Output

`machines` commands use compact human output by default so agent terminals do not
receive full manifests, route objects, plan commands, or event records unless
requested.

Use these flags to disclose more detail:

- `--json` on CLI commands returns the full structured payload for scripts.
- `--verbose` on supported CLI commands adds host/path or command previews while
  still keeping rows capped and text truncated.
- `--limit <n>` and `--cursor <n>` page list-like CLI output where supported.
- `--all` shows every compact row where supported.
- MCP tools return compact text by default; pass `verbose: true` to return the
  full JSON text payload.

Default compact output is intended for humans and agents. Use `--json` or
`verbose: true` for machine-readable consumers.
