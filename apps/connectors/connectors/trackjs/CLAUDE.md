# CLAUDE.md

Guidance for working with the TrackJS connector.

## Overview

`connect-trackjs` wraps the public [TrackJS Data API](https://docs.trackjs.com/data-api/). It is read-only and uses account-owner `customerId` + `apiKey` credentials.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

- Base URL: `https://api.trackjs.com/{customerId}/v1`
- Header: `Authorization: {API_KEY}` (raw key, **not** `Bearer`)
- Optional fallback: `?key={API_KEY}` query parameter (`useKeyQueryParam` in client config)

Credentials are visible only to TrackJS account owners.

## Endpoints

| Method | Path | CLI |
|--------|------|-----|
| GET | `/errors` | `errors list` |
| GET | `/errors/messages` | `errors messages` |
| GET | `/errors/urls` | `errors urls` |
| GET | `/errors/daily` | `errors daily` |
| GET | `/errors/hourly` | `errors hourly` |

Responses use `{ data, metadata }` pagination envelopes.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TRACKJS_API_KEY` | API key |
| `TRACKJS_CUSTOMER_ID` | Customer ID |

Profiles live under `~/.hasna/connectors/connect-trackjs/profiles/`.

## Structure

```
src/
├── api/client.ts   # HTTP client (customer ID in URL)
├── api/errors.ts   # Data API modules
├── cli/index.ts    # Commander CLI
├── types/index.ts  # TrackjsApiError + response types
└── utils/config.ts # apiKey + customerId profiles
```
