# open-configs

AI coding agent configuration manager. Store, version, apply, and share all your AI coding configs.

## Quick Reference

```bash
configs list                    # list all stored configs
configs show <slug>             # view content + metadata
configs pull                    # sync known configs from disk → DB
configs push                    # apply DB configs → disk
configs sync --project .        # sync project-scoped configs
configs diff                    # diff all stored vs disk
configs scan --fix              # find + redact secrets
configs status                  # health check
configs doctor                  # validate syntax + permissions
configs init                    # first-time setup
configs watch                   # auto-sync on file changes
configs backup                  # timestamped export
configs template render <id> --env --apply  # render templates with env vars
```

## Architecture

```
src/types/index.ts    — all TypeScript types
src/db/               — SQLite (bun:sqlite): configs, snapshots, profiles, machines
src/lib/              — apply, sync, redact, export/import, template
src/cli/index.tsx     — 26 CLI commands (Commander + chalk)
src/mcp/index.ts      — 13 MCP tools (lean stubs pattern)
src/server/index.ts   — Hono REST API (port 3457, serves dashboard)
src/index.ts          — library exports
sdk/                  — @hasna/configs-sdk (zero-dep fetch client)
dashboard/            — React+Vite (5 pages)
```

## Key Design Decisions

- **KNOWN_CONFIGS map** — only sync ~30 curated config files, never recursive dir walk
- **Secret redaction** — always redact before storing (key-name + value-pattern matching)
- **Templates** — redacted values become {{VAR}} placeholders, render with `--env` or `--var`
- **Profiles** — named bundles of configs for full-machine setup
- **Snapshots** — auto-versioned on every apply

## Testing

```bash
bun test              # 103 tests, 0 failures
```

## Publishing

```bash
bun run build && npm version patch && bun publish --access public
cd sdk && bun run build && bun publish --access public
```
