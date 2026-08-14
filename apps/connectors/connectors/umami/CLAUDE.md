# CLAUDE.md

This file provides guidance to Claude Code when working with the connect-umami connector.

## Project Overview

connect-umami is a TypeScript connector for the Umami analytics platform. It provides CLI and programmatic access to website management, analytics statistics, events, event data, and team APIs with multi-profile configuration support.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## API Notes

- **Umami Cloud base URL**: `https://api.umami.is/v1` (optional region path: `/us` or `/eu`)
- **Self-hosted base URL**: `{host}/api`
- **Auth**: Custom header `x-umami-api-key: <api_key>`
- **Docs**: https://docs.umami.is/docs/cloud/api-key and https://docs.umami.is/docs/api

Cloud API paths are relative to the v1 base (for example `/websites`). Self-hosted instances use the same resource paths under `/api`.

## Authentication

API Key authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-umami config set-key <key>`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `UMAMI_API_KEY` | Umami API key (required) |
| `UMAMI_HOST` | API host (`https://api.umami.is/v1` for cloud or self-hosted origin) |
| `UMAMI_BASE_URL` | Explicit API base URL override |
| `UMAMI_REGION` | Cloud region (`us` or `eu`) |

## CLI Commands

### Profile & Config
```bash
connect-umami profile list|use|create|delete|show
connect-umami config set-key <key>
connect-umami config set-host <host>
connect-umami config set-base-url <url>
connect-umami config set-region <us|eu>
connect-umami config show
connect-umami config clear
```

### Websites
```bash
connect-umami websites list|get|create|update|delete|reset|active|daterange
```

### Statistics
```bash
connect-umami stats summary <websiteId> --start-at <date|ms> --end-at <date|ms>
connect-umami stats pageviews <websiteId> --start-at ... --end-at ... [--unit day]
connect-umami stats metrics <websiteId> --type browser --start-at ... --end-at ...
connect-umami stats metrics-expanded <websiteId> --type path --start-at ... --end-at ...
connect-umami stats events-series <websiteId> --start-at ... --end-at ...
connect-umami stats events <websiteId> --start-at ... --end-at ...
connect-umami stats event-stats <websiteId> --start-at ... --end-at ...
connect-umami stats event-data list|get|events|fields|properties|values|stats
```

### Teams
```bash
connect-umami teams list|get|create|update|delete|join
connect-umami teams users list|add|get|update|remove
connect-umami teams websites <teamId>
```

## Data Storage

```
~/.hasna/connectors/connect-umami/
├── current_profile
└── profiles/
    ├── default.json
    └── {name}.json
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
