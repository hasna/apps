# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-the-trade-desk is a TypeScript connector for The Trade Desk programmatic advertising REST API. It provides campaign management, event listing, search, and a raw-request escape hatch through a CLI and programmatic interface.

## API Reference

- **Base URL**: `https://api.thetradedesk.com/v1`
- **Auth**: Bearer token — `Authorization: Bearer <api_key>`
- **Sandbox** (optional): override base URL via `THE_TRADE_DESK_BASE_URL` or profile `baseUrl`

## API Modules

| Module | Description | Key Methods |
|--------|-------------|-------------|
| Campaigns | Campaign management | list, get, create |
| Events | Conversion/event data | list |
| Search | Platform search | search |
| Raw | Arbitrary API calls | rawRequest |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `THE_TRADE_DESK_API_KEY` | Long-lived API token (required) |
| `THE_TRADE_DESK_BASE_URL` | Optional API base URL override |

## Key Patterns

- Bearer token authentication via `Authorization: Bearer <token>`
- Multi-profile config under `~/.hasna/connectors/connect-the-trade-desk/profiles/`
- Environment variables override profile config
- `--profile` flag selects profile for a single command

## CLI Commands

```bash
connect-the-trade-desk campaigns list [--query key=value]
connect-the-trade-desk campaigns get <campaignId>
connect-the-trade-desk campaigns create --json '{"name":"..."}'
connect-the-trade-desk events list [--query key=value]
connect-the-trade-desk search --json '{"query":"..."}'
connect-the-trade-desk raw-request <method> <path> [--query key=value] [--json '{}']
connect-the-trade-desk profile list|use|create|delete|show
connect-the-trade-desk config set-key|show|clear
```

## Build & Run

```bash
bun install
bun run dev              # Run CLI in development
bun run build            # Build for distribution
bun run typecheck        # Type check
bun test src/api/client.test.ts
```
