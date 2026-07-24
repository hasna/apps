# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-tricentis is a TypeScript connector for the Tricentis test automation platform API. It provides multi-profile configuration, Bearer token authentication, and CLI access to tests, events, search, and raw HTTP requests against `https://api.tricentis.com/v1` (configurable via `TRICENTIS_BASE_URL`).

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

Bearer Token authentication. Credentials can be set via:
- Environment variable `TRICENTIS_API_KEY`
- Profile configuration: `connect-tricentis config set-key <key>`

Optional `TRICENTIS_BASE_URL` overrides the default API host for tenant-specific Tricentis deployments.

## CLI Commands

```bash
connect-tricentis config set-key <key>
connect-tricentis config set-base-url <url>
connect-tricentis tests list
connect-tricentis tests get <testId>
connect-tricentis tests create --name "Test name"
connect-tricentis events list
connect-tricentis search --query "keyword"
connect-tricentis raw-request --path /tests -X GET
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TRICENTIS_API_KEY` | API key / bearer token (overrides profile) |
| `TRICENTIS_BASE_URL` | API base URL override (optional) |

## Data Storage

```
~/.hasna/connectors/connect-tricentis/
├── current_profile
└── profiles/
    └── default.json
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
