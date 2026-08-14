# CLAUDE.md

## Project Overview

connect-unit is a TypeScript CLI and library for the Unit.sh Banking-as-a-Service JSON:API.

## Build & Run

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

Bearer token authentication. Credentials via:
- `UNIT_API_TOKEN` environment variable
- `connect-unit config set-token <token>`

Default environment is **sandbox** (`https://api.s.unit.sh`). Production uses `https://api.unit.sh`.

## Data Storage

```
~/.hasna/connectors/connect-unit/
├── current_profile
└── profiles/
    └── default.json
```

## API Modules

- accounts, applications, customers, cards, transactions, payments, counterparties, webhooks, events

## Environment Variables

| Variable | Description |
|----------|-------------|
| `UNIT_API_TOKEN` | Unit API bearer token |
| `UNIT_ENVIRONMENT` | `sandbox` (default) or `production` |
