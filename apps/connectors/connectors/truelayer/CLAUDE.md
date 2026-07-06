# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-truelayer is a TypeScript connector for the TrueLayer open banking API with multi-profile configuration support. It provides access to Payments, Events, and Search APIs.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

**Bearer token** authentication. Credentials can be set via:
- Environment variable: `TRUELAYER_ACCESS_TOKEN`
- Profile configuration: `connect-truelayer config set-token <token>`

Optional: `TRUELAYER_SANDBOX=true` for sandbox API (`https://api.truelayer-sandbox.com/v1`).

## Project Structure

```
src/
├── api/
│   ├── client.ts      # HTTP client with Bearer auth
│   ├── payments.ts    # Payments API
│   ├── events.ts      # Events API
│   ├── search.ts      # Search API
│   └── index.ts       # Main connector class
├── cli/index.ts       # CLI commands
├── types/index.ts     # TypeScript types
├── utils/
│   ├── config.ts      # Multi-profile configuration
│   └── output.ts      # CLI output formatting
└── index.ts           # Library exports
```

## Key Patterns

Profiles stored in `~/.hasna/connectors/connect-truelayer/profiles/`.

Payments v3 may require `Idempotency-Key` and `Tl-Signature` headers on mutating calls — the client and CLI support optional header passthrough; do not add signing libraries unless required.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TRUELAYER_ACCESS_TOKEN` | Bearer access token (overrides profile) |
| `TRUELAYER_SANDBOX` | Set to "true" for sandbox environment |
| `TRUELAYER_BASE_URL` | Override API base URL |
| `TRUELAYER_CLIENT_ID` | Optional OAuth client ID |
| `TRUELAYER_CLIENT_SECRET` | Optional OAuth client secret |

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
