# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-xray is a TypeScript connector for the Xray test management platform API (`https://api.xray.com/v1`). It provides scans, events, search, and raw API access.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

Bearer token authentication:

```
Authorization: Bearer <api_key>
```

Configure via `XRAY_API_KEY` environment variable or `connect-xray config set-key <key>`.

Optional `XRAY_BASE_URL` overrides the default `https://api.xray.com/v1`.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/scans` | List scans |
| POST | `/scans` | Create a scan |
| GET | `/scans/{id}` | Get scan by ID |
| GET | `/events` | List events |
| POST | `/search` | Search resources |
| * | arbitrary | `raw request` escape hatch |

## Project Structure

```
src/
├── api/
│   ├── client.ts   # HTTP client with Bearer auth
│   ├── scans.ts    # Scan endpoints
│   ├── events.ts   # Event endpoints
│   ├── search.ts   # Search endpoint
│   ├── raw.ts      # Raw request helper
│   └── index.ts    # Main Connector class
├── cli/index.ts
├── types/index.ts
├── utils/config.ts
└── utils/output.ts
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `XRAY_API_KEY` | API key (overrides profile) |
| `XRAY_BASE_URL` | Optional API base URL |

## CLI Commands

```bash
connect-xray scans list|get|create
connect-xray events list
connect-xray search run
connect-xray raw request --path /scans
connect-xray config set-key|set-base-url|show|clear
connect-xray profile list|use|create|delete|show
```

## Notes

Public docs for api.xray.com are sparse. Endpoint contracts are based on inventory metadata; verify against live API responses when integrating.
