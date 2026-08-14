# connect-vitally

Vitally connector for the [Vitally REST API](https://docs.vitally.io/en/articles/9880649-rest-api-overview) — customer success platform for accounts, users, events, conversations, tasks, and notes.

## Authentication

Vitally uses **HTTP Basic Auth**: pass your API secret as the username with an empty password. You can copy a pre-encoded `Authorization` header from **Settings → Integrations → Vitally REST API** in the Vitally UI, or let the connector encode `VITALLY_API_KEY` automatically.

## Base URLs

| Region | Base URL pattern |
|--------|------------------|
| US (default) | `https://{subdomain}.rest.vitally.io` |
| EU | `https://rest.vitally-eu.io` |

Set `VITALLY_SUBDOMAIN` to the subdomain from your Vitally login URL (`https://yoursubdomain.vitally.io`).

## Quick start

```bash
cd connectors/vitally
bun install
bun run dev config set-key <api-secret>
bun run dev config set-subdomain <subdomain>
bun run dev account list
```

## CLI

```bash
connect-vitally profile list|use|create|delete|show
connect-vitally config set-key|set-subdomain|set-region|show|clear
connect-vitally account list|get|create
connect-vitally event list
connect-vitally search [--query <q>] [--body <json>]
connect-vitally raw --method GET --path /resources/accounts
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `VITALLY_API_KEY` | API secret key |
| `VITALLY_SUBDOMAIN` | Workspace subdomain (US) |
| `VITALLY_REGION` | `us` or `eu` |
| `VITALLY_BASE_URL` | Override computed base URL |

## Build

```bash
bun run typecheck
bun run build
bun test
```

## License

Apache-2.0
