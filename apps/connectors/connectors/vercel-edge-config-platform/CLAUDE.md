# CLAUDE.md

## Project Overview

connect-vercel-edge-config-platform is a TypeScript connector for the Vercel Edge Config **management** REST API at `https://api.vercel.com/v1/edge-config`.

## Build & Run

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

Bearer token via `VERCEL_TOKEN` or profile config. Optional `VERCEL_TEAM_ID` for team-scoped requests.

## Data Storage

```
~/.hasna/connectors/connect-vercel-edge-config-platform/
├── current_profile
└── profiles/
    └── default.json
```

## Scope

Management API only (`api.vercel.com`). Does not use `edge-config.vercel.com` read endpoint.

## API Coverage

- Edge Configs: list, create, get, update, delete
- Items: list, get, batch patch
- Schema: get, update, delete
- Tokens: list, get, create, delete
- Backups: list, get, restore
