# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-stripe-financial-connections is a TypeScript connector for the Stripe Financial Connections REST API. It provides a CLI and programmatic interface for managing financial connection items, events, and search.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
```

## CLI Commands

```bash
# Profile management
connect-stripe-financial-connections profile list
connect-stripe-financial-connections profile use <name>
connect-stripe-financial-connections profile create <name>
connect-stripe-financial-connections profile delete <name>

# Configuration
connect-stripe-financial-connections config set-key <key>
connect-stripe-financial-connections config set-base-url <url>
connect-stripe-financial-connections config show
connect-stripe-financial-connections config clear

# Items
connect-stripe-financial-connections items list
connect-stripe-financial-connections items create --body '{"..."}'
connect-stripe-financial-connections items get <itemId>

# Events
connect-stripe-financial-connections events list

# Search
connect-stripe-financial-connections search --body '{"query":"..."}'

# Raw API
connect-stripe-financial-connections raw --path /items --method GET
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STRIPE_FINANCIAL_CONNECTIONS_API_KEY` | API key (overrides profile config) |
| `STRIPE_FINANCIAL_CONNECTIONS_BASE_URL` | Optional API base URL override |

## Authentication

Bearer Token authentication. API base URL defaults to `https://api.stripefinancialconnections.com/v1`.

## Data Storage

```
~/.hasna/connectors/connect-stripe-financial-connections/
├── current_profile
└── profiles/
    ├── default.json
    └── {name}.json
```

Profile JSON structure:
```json
{
  "apiKey": "your-api-key",
  "baseUrl": "https://api.stripefinancialconnections.com/v1"
}
```

## Project Structure

```
src/
├── api/
│   ├── client.ts     # HTTP client with Bearer auth
│   └── index.ts      # API wrapper
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts      # Type definitions
├── utils/
│   ├── config.ts     # Multi-profile configuration
│   └── output.ts     # CLI output formatting
└── index.ts          # Library exports
```
