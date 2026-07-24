# CLAUDE.md

This file provides guidance to Claude Code when working with the Trustpilot connector.

## Project Overview

`@hasna/connect-trustpilot` is a TypeScript CLI and library for the [Trustpilot Business API](https://developers.trustpilot.com/).

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

Trustpilot uses dual authentication:

- **Public reads**: `apikey` header from API key (`TRUSTPILOT_API_KEY`)
- **Private/mutating endpoints**: `Authorization: Bearer <access_token>` (`TRUSTPILOT_ACCESS_TOKEN`), with API key fallback

OAuth authorization URL helper: `connect-trustpilot oauth auth-link --redirect-uri <url>`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TRUSTPILOT_API_KEY` | API key (overrides profile) |
| `TRUSTPILOT_ACCESS_TOKEN` | OAuth access token (overrides profile) |
| `TRUSTPILOT_BASE_URL` | Override base URL (default `https://api.trustpilot.com/v1`) |

## Data Storage

```
~/.hasna/connectors/connect-trustpilot/
├── current_profile
└── profiles/
    └── default.json
```

Profile JSON:
```json
{
  "apiKey": "your-api-key",
  "accessToken": "oauth-access-token"
}
```

## API Modules

- `categories` — list/get categories and category business units
- `businessUnits` — find, search, profile, reviews, web links
- `reviews` — get, reply, delete-reply, report, private list
- `invitations` — create link, send email, list templates
- `products` — product reviews list/reply/summary
- `consumers` — profile and reviews
- `tags` — custom tags and service review questions
- `oauth` — generate auth link URL

## Adding Endpoints

1. Add types in `src/types/index.ts`
2. Add method in the appropriate `src/api/*.ts` module
3. Add CLI command in `src/cli/index.ts`
4. Add test coverage in `src/api/client.test.ts`
