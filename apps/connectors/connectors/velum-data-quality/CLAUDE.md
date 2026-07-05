# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-velum-data-quality is a TypeScript connector for the Velum data quality platform API. It provides a CLI and library for managing data quality checks, events, and search.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
bun run dev -- --help # Show CLI help
```

## API Details

- **Base URL**: `https://api.velum-data-quality.com/v1` (configurable via `VELUM_DATA_QUALITY_BASE_URL`)
- **Auth**: Bearer token: `Authorization: Bearer <API_KEY>`

## API Resources

| Resource | Endpoints | Description |
|----------|-----------|-------------|
| Checks | `GET/POST /checks`, `GET /checks/:id` | Data quality checks |
| Events | `GET /events` | Quality events |
| Search | `POST /search` | Search records |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VELUM_DATA_QUALITY_API_KEY` | API key (overrides profile config) |
| `VELUM_DATA_QUALITY_BASE_URL` | Optional API base URL override |

## CLI Commands

```bash
connect-velum-data-quality checks list
connect-velum-data-quality checks get <checkId>
connect-velum-data-quality checks create --body '{"name":"example"}'
connect-velum-data-quality events list
connect-velum-data-quality search --body '{"query":"..."}'
connect-velum-data-quality raw --path /checks --method GET
connect-velum-data-quality config set-key <key>
connect-velum-data-quality profile list
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Bun runtime
