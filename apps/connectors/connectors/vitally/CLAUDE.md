# CLAUDE.md

Guidance for working with the Vitally connector.

## Project Overview

connect-vitally is a TypeScript CLI and library for the [Vitally REST API](https://docs.vitally.io/en/articles/9880649-rest-api-overview). It supports multi-profile configuration, HTTP Basic authentication, and Commander.js CLI commands for accounts, events, search, and raw requests.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

API key (HTTP Basic Auth). The API secret is sent as the Basic auth username with an empty password (`Authorization: Basic <base64(secret:)>). Users may also store a pre-encoded Basic header copied from the Vitally REST API integration settings.

Configure via:

- `connect-vitally config set-key <api-secret>`
- Environment variable `VITALLY_API_KEY`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VITALLY_API_KEY` | API secret key (overrides profile) |
| `VITALLY_SUBDOMAIN` | Vitally workspace subdomain for US data center |
| `VITALLY_REGION` | Data region: `us` (default) or `eu` |
| `VITALLY_BASE_URL` | Override base URL (optional) |

## CLI Commands

```bash
connect-vitally profile list|use|create|delete|show
connect-vitally config set-key|set-subdomain|set-region|show|clear
connect-vitally account list|get|create
connect-vitally event list
connect-vitally search [--query <q>] [--body <json>]
connect-vitally raw --method <METHOD> --path <path> [--body <json>]
```

## Data Storage

```
~/.hasna/connectors/connect-vitally/
├── current_profile
└── profiles/
    ├── default.json
    └── {name}.json
```

Profile JSON:

```json
{
  "apiKey": "secret_xxx",
  "subdomain": "your-subdomain",
  "region": "us"
}
```

## API Notes

- US base: `https://{subdomain}.rest.vitally.io/resources/...`
- EU base: `https://rest.vitally-eu.io/resources/...`
- Rate limit: ~1000 requests/minute
- Do not use legacy `api.vitally.io` endpoints

## Dependencies

- commander
- chalk
