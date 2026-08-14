# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-unifold is a TypeScript connector for the Unifold cross-chain deposit API. It provides access to users, payment intents, treasury accounts, and deposit addresses via Bearer token authentication.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
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
├── api/
│   ├── client.ts     # HTTP client with Bearer authentication
│   └── index.ts      # Main Unifold connector class
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts      # Type definitions
├── utils/
│   ├── config.ts     # Multi-profile configuration
│   └── output.ts     # CLI output formatting
└── index.ts          # Library exports
```

## Authentication

Bearer Token authentication. Credentials can be set via:
- Environment variable: `UNIFOLD_API_KEY`
- Profile configuration: `connect-unifold config set-key <key>`

## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.hasna/connectors/connect-unifold/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- Environment variables override profile config

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/users` | List users |
| GET | `/users/{id}` | Get user |
| GET | `/payment-intents` | List payment intents |
| GET | `/payment-intents/{id}` | Get payment intent |
| POST | `/payment-intents` | Create payment intent |
| POST | `/treasury/accounts` | Create treasury account |
| GET | `/treasury/accounts/{id}` | Get treasury account |
| GET | `/deposit-addresses` | List deposit addresses |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `UNIFOLD_API_KEY` | API key (overrides profile) |
| `UNIFOLD_BASE_URL` | Custom API base URL |

## Data Storage

```
~/.hasna/connectors/connect-unifold/
├── current_profile
└── profiles/
    ├── default.json
    └── {name}.json
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
