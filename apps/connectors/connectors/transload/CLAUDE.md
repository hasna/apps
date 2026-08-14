# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-transload is a TypeScript connector for the Transload API. It provides a CLI and library for freight dimension measurement and warehouse vision — sites, shipments, cameras, and measurement sync.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
bun test              # Run tests
bun run dev -- --help # Show CLI help
```

## API Details

- **Base URL**: `https://api.transload.com/v1` (configurable via `TRANSLOAD_BASE_URL`)
- **Auth**: Bearer token: `Authorization: Bearer <API_KEY>`
- **Product**: Freight dimension measurement and warehouse computer vision
- **Help**: https://www.ycombinator.com/companies/transload

## API Resources

| Resource | Endpoints | Description |
|----------|-----------|-------------|
| Sites | `/sites` | Warehouse sites |
| Shipments | `/shipments` | Measured freight shipments |
| Measurements | `/shipments/{id}/measurement`, `/measurements/sync` | CV dimension data |
| Cameras | `/cameras` | Warehouse CCTV cameras |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TRANSLOAD_API_KEY` | API key (overrides profile config) |
| `TRANSLOAD_BASE_URL` | Optional custom API base URL |

## CLI Commands

```bash
connect-transload sites list
connect-transload sites get <siteId>
connect-transload shipments list
connect-transload shipments get <shipmentId>
connect-transload measurement get <shipmentId>
connect-transload cameras list
connect-transload measurements sync [--body <json>]
connect-transload raw-request --path /sites [--method GET] [--query <json>] [--body <json>]
connect-transload config set-key <key>
connect-transload profile list
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Bun runtime
