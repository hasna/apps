# CLAUDE.md

Workato automation platform API connector.

## Commands

```bash
bun install
bun run dev
bun run typecheck
bun test
```

## API

- Base URL: `https://www.workato.com/api`
- Auth: Bearer token (`WORKATO_API_TOKEN`)

## Modules

- `recipes` — list, get, start, stop
- `jobs` — list, get (per recipe)
- `connections` — CRUD
- `folders` — CRUD
- `projects` — list, get, export
- `lookup-tables` — list, get, row CRUD, lookup
- `properties` — list, upsert
- `users` — list

## Config

Profiles stored at `~/.hasna/connectors/workato/profiles/`.
