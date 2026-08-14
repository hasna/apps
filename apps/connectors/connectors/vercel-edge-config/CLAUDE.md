# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-vercel-edge-config is a TypeScript connector for the Vercel Edge Config management REST API (`api.vercel.com/v1/edge-config`). It provides a CLI and programmatic interface for managing Edge Configs, items, tokens, schema, and backups.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
bun test              # Run tests
```

## CLI Commands

```bash
# Authentication & profiles
connect-vercel-edge-config config set-key <key>
connect-vercel-edge-config config set-team <teamId>
connect-vercel-edge-config profile list|use|create|delete|show

# Edge Configs
connect-vercel-edge-config edge-config list
connect-vercel-edge-config edge-config get <edgeConfigId>
connect-vercel-edge-config edge-config create <slug>
connect-vercel-edge-config edge-config update <edgeConfigId>
connect-vercel-edge-config edge-config delete <edgeConfigId>

# Items
connect-vercel-edge-config item get <edgeConfigId> <key>
connect-vercel-edge-config items patch <edgeConfigId> <file.json>

# Schema, tokens, backups
connect-vercel-edge-config schema get <edgeConfigId>
connect-vercel-edge-config token list|create <edgeConfigId>
connect-vercel-edge-config backup list <edgeConfigId>

# Escape hatch
connect-vercel-edge-config raw <METHOD> <path> [--body <json>] [--query <json>]
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VERCEL_TOKEN` | Vercel API token (Bearer auth) |
| `VERCEL_EDGE_CONFIG_API_KEY` | Alias for API token |
| `VERCEL_TEAM_ID` | Team ID for team-scoped requests |
| `VERCEL_EDGE_CONFIG_BASE_URL` | Override API base URL (default `https://api.vercel.com`) |

## Authentication

Uses Bearer token authentication. Create a token at https://vercel.com/account/tokens

## Data Storage

```
~/.hasna/connectors/connect-vercel-edge-config/
├── current_profile
└── profiles/
    └── default.json
```

Profile JSON structure:
```json
{
  "apiKey": "vercel_token_xxx",
  "teamId": "team_xxx",
  "baseUrl": "https://api.vercel.com"
}
```

## API Reference

- [Vercel Edge Config REST API](https://vercel.com/docs/rest-api/edge-config)
- [OpenAPI spec](https://openapi.vercel.sh/)

## Project Structure

```
src/
├── api/
│   ├── client.ts       # HTTP client with Bearer auth
│   ├── index.ts        # Edge Config API wrapper
│   └── client.test.ts
├── cli/
│   └── index.ts
├── types/
│   └── index.ts
├── utils/
│   ├── config.ts
│   └── output.ts
└── index.ts
```
