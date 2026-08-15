# CLAUDE.md

Guidance for working with the Travo Data (`travo-real-estate`) connector.

## Overview

REST API connector for Travo Data real estate listings, events, and search.

- **Base URL**: `https://api.travo-real-estate.com/v1`
- **Auth**: Bearer token (`Authorization: Bearer <api_key>`)
- **Category**: Data & Analytics

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## API Endpoints

| Method | Path | Connector method |
|--------|------|------------------|
| GET | `/listings` | `listListings(params?)` |
| POST | `/listings` | `createListing(body)` |
| GET | `/listings/:listingId` | `getListing(listingId)` |
| GET | `/events` | `listEvents(params?)` |
| POST | `/search` | `search(body)` |
| * | any | `rawRequest(options)` |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TRAVO_REAL_ESTATE_API_KEY` | API key (required) |
| `TRAVO_REAL_ESTATE_BASE_URL` | Optional API base URL override |

## Config Storage

```
~/.hasna/connectors/connect-travo-real-estate/
├── current_profile
└── profiles/
    └── default.json
```

## CLI

```bash
connect-travo-real-estate profile list|use|create|delete|show
connect-travo-real-estate config set-key|set-base-url|show|clear
connect-travo-real-estate listings list|get|create
connect-travo-real-estate events list
connect-travo-real-estate search --body <json>
connect-travo-real-estate raw <method> <path>
```

## authType

`apikey` / `bearer`
