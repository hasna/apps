# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-trustpilot-business is a TypeScript CLI for the Trustpilot Business API. It supports public endpoints via API key and private Business routes via client credentials access tokens.

Documentation: https://developers.trustpilot.com

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

API Key authentication via the `apikey` HTTP header. Set your Trustpilot API key (Client ID) using environment variable or profile config.

Optional: configure an API secret (Client Secret) to access private Business API routes under `/private/*` that require an access token obtained via client credentials.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TRUSTPILOT_BUSINESS_API_KEY` | Trustpilot API key (Client ID) |
| `TRUSTPILOT_BUSINESS_API_SECRET` | API secret for private routes |
| `TRUSTPILOT_BUSINESS_BASE_URL` | Override main API base URL |
| `TRUSTPILOT_BUSINESS_INVITATIONS_BASE_URL` | Override invitations API base URL |

## CLI Commands

```bash
# Reviews
connect-trustpilot-business reviews list <businessUnitId> [--private]
connect-trustpilot-business reviews get <reviewId> [--private]
connect-trustpilot-business reviews create-invitation <businessUnitId> --consumer-email user@example.com
connect-trustpilot-business reviews create-link <businessUnitId> --email user@example.com

# Events (webhooks)
connect-trustpilot-business events list

# Search
connect-trustpilot-business search business-units "example.com"
connect-trustpilot-business search find example.com

# Raw request escape hatch
connect-trustpilot-business raw-request --path /reviews/{id}
```

## Project Structure

```
src/
├── api/
│   ├── client.ts
│   ├── reviews.ts
│   ├── events.ts
│   ├── search.ts
│   └── index.ts
├── cli/index.ts
├── types/index.ts
└── utils/
    ├── config.ts
    └── output.ts
```

## Data Storage

```
~/.hasna/connectors/connect-trustpilot-business/
├── current_profile
└── profiles/
    └── default.json
```
