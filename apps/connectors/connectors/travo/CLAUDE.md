# CLAUDE.md

This file provides guidance to Claude Code when working with the Travo connector.

## Project Overview

connect-travo is a TypeScript connector for the Travo real-estate intelligence REST API (`https://api.travoai.com/v1`). It provides a CLI and library for property search, comps, ownership, zoning, financials, and enrichment.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

Bearer token authentication via API key.

| Variable | Description |
|----------|-------------|
| `TRAVO_API_KEY` | API key (overrides profile) |
| `TRAVO_BASE_URL` | Optional API base URL override |

Configure via CLI: `connect-travo config set-key <key>`

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/properties/search` | Search properties |
| GET | `/properties/{id}` | Get property details |
| GET | `/properties/{id}/comps` | Comparable properties |
| GET | `/properties/{id}/ownership` | Ownership data |
| GET | `/properties/{id}/zoning` | Zoning data |
| GET | `/properties/{id}/financials` | Financial data |
| POST | `/properties/{id}/enrich` | Enrich property data |

Path segments are URL-encoded. Property IDs with spaces (e.g. `prop 1`) become `prop%201`.

## CLI Commands

```bash
connect-travo config set-key <key>
connect-travo properties search --asset-type rv_park --state TX
connect-travo properties get "prop 1"
connect-travo properties comps "prop 1" --radius 25
connect-travo properties ownership <propertyId>
connect-travo properties zoning <propertyId>
connect-travo properties financials <propertyId>
connect-travo properties enrich <propertyId> --sources web,phone
connect-travo raw-request --path /properties/search --query '{"q":"retail"}'
```

## Data Storage

```
~/.hasna/connectors/connect-travo/
├── current_profile
└── profiles/
    └── default.json
```
