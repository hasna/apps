# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-x is a TypeScript connector for the X (Twitter) API v2. It provides both a CLI and library interface for:

## Build & Run Commands

```bash
# Install dependencies
bun install

# Run CLI in development
bun run dev

# Build for distribution
bun run build

# Type check
bun run typecheck
```

## Code Style

- TypeScript with strict mode
- ESM modules (`type: module`)
- Async/await for all async operations
- Minimal dependencies: commander, chalk
- Type annotations required everywhere

## Project Structure

```
src/
├── api/           # API client modules
│   ├── client.ts  # HTTP client with authentication
│   └── index.ts   # Main connector class
├── cli/
│   └── index.ts   # CLI commands
├── types/
│   └── index.ts   # TypeScript types
├── utils/
│   ├── config.ts  # Multi-profile configuration
│   └── output.ts  # CLI output formatting
└── index.ts       # Library exports
```

## Pricing & Access (2026)

### Pay-as-you-go Model (Feb 2026)
X moved to **credit-based pay-as-you-go pricing** (Feb 6, 2026), replacing fixed $200/month Basic and $5,000/month Pro plans.

- Purchase credits in advance; balance decreases per API call
- Unit price varies by endpoint (check Developer Console for current prices)
- Duplicate protection: same post/user fetched multiple times on same day is not double-charged (with exceptions)
- Auto-recharge and spending limits available
- **Public Utility apps** continue to receive free scaled access
- Legacy free tier users receive a $10 one-time voucher when migrating
- Existing Basic/Pro subscribers can opt-in to pay-as-you-go or keep their plan

Pricing reference: https://docs.x.com/x-api/getting-started/pricing

## Authentication

OAuth authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-x config set-key <key>`
- OAuth flow: `connect-x oauth login`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `X_API_KEY` | API key (Consumer Key) |
| `X_API_SECRET` | API secret (Consumer Secret) |
| `X_BEARER_TOKEN` | Optional pre-generated Bearer token |
| `X_CLIENT_ID` | OAuth 2.0 Client ID |
| `X_CLIENT_SECRET` | OAuth 2.0 Client Secret (optional) |
| `X_ACCESS_TOKEN` | OAuth 2.0 user access token |
| `X_REFRESH_TOKEN` | OAuth 2.0 refresh token |
| `X_OAUTH1_ACCESS_TOKEN` | OAuth 1.0a access token |
| `X_OAUTH1_ACCESS_TOKEN_SECRET` | OAuth 1.0a access token secret |

## Data Storage

```
~/.hasna/connectors/connect-x/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
