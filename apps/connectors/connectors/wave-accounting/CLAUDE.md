# CLAUDE.md

Guidance for working with the Wave Accounting connector.

## Project Overview

`connect-wave-accounting` is a TypeScript CLI and library for Wave's public GraphQL API. It supports OAuth2 and full-access bearer tokens for businesses, invoices, customers, and accounts.

**Not to be confused with** `connect-wavelineextract` (different product).

## Build & Run

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## API Endpoints

| Purpose | URL |
|---------|-----|
| GraphQL | `https://gql.waveapps.com/graphql/public` |
| OAuth authorize | `https://api.waveapps.com/oauth2/authorize/` |
| OAuth token | `https://api.waveapps.com/oauth2/token/` |

## Authentication

- **Bearer token (dev):** Full-access token from Wave developer portal
- **OAuth2 (production):** Scopes per https://developer.waveapps.com/hc/en-us/articles/360032818132-OAuth-Scopes

Auth type: `oauth` / `bearer`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WAVE_ACCESS_TOKEN` | Bearer access token |
| `WAVE_CLIENT_ID` | OAuth client ID |
| `WAVE_CLIENT_SECRET` | OAuth client secret |
| `WAVE_BUSINESS_ID` | Default business ID |

## Configuration Storage

```
~/.hasna/connectors/wave-accounting/
├── current_profile
└── profiles/
    └── default.json
```

## Business Context

Most operations require a `businessId`. Set via `--business-id`, `config set-business-id`, or profile default.

## Dependencies

- commander
- chalk

No browser-use or scraper dependencies.
