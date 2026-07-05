# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-upstash-api-platform is a TypeScript connector for the Upstash Developer (Management) API. It provides CLI and library access to teams, vector index management, audit logs, and a raw request escape hatch.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
bun test              # Run connector tests
```

## CLI Commands

```bash
# Authentication
connect-upstash-api-platform auth set-email <email>
connect-upstash-api-platform auth set-key <apiKey>
connect-upstash-api-platform auth status
connect-upstash-api-platform auth clear

# Profile management
connect-upstash-api-platform profile list
connect-upstash-api-platform profile use <name>
connect-upstash-api-platform profile create <name>
connect-upstash-api-platform profile delete <name>
connect-upstash-api-platform profile show [name]

# Teams
connect-upstash-api-platform team list
connect-upstash-api-platform team create <name> [--copy-cc]
connect-upstash-api-platform team members <teamId>

# Vector indices
connect-upstash-api-platform vector list
connect-upstash-api-platform vector get <id>
connect-upstash-api-platform vector create --name <name> --region <region> --similarity <fn> --dimensions <n>
connect-upstash-api-platform vector delete <id>

# Account
connect-upstash-api-platform account audit-logs

# Raw API
connect-upstash-api-platform raw request --method GET --path /teams
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `UPSTASH_EMAIL` | Upstash account email (Basic auth username; overrides profile) |
| `UPSTASH_API_KEY` | Management API key (Basic auth password; overrides profile) |

## Authentication

API Key authentication via HTTP Basic (`email` + `api_key` profile fields). Create keys in the Upstash Console: https://console.upstash.com/account/api

Documentation: https://upstash.com/docs/devops/developer-api/authentication

## Data Storage

```
~/.hasna/connectors/connect-upstash-api-platform/
├── current_profile
└── profiles/
    ├── default.json
    └── {name}.json
```

Profile JSON structure:

```json
{
  "email": "you@example.com",
  "apiKey": "management_api_key"
}
```

## Code Style

- TypeScript with strict mode
- ESM modules (`type: module`)
- Async/await for all async operations
- Minimal dependencies: commander, chalk

## Project Structure

```
src/
├── api/
│   ├── client.ts     # HTTP client with Basic auth
│   ├── teams.ts      # Team endpoints
│   ├── vector.ts     # Vector index endpoints
│   ├── account.ts    # Audit log endpoints
│   └── index.ts      # Main connector class
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts      # Type definitions
├── utils/
│   ├── config.ts     # Multi-profile configuration
│   └── output.ts     # CLI output formatting
└── index.ts          # Library exports
```

## API Coverage

- Teams: list, create, list members
- Vector: list, get, create, delete indices
- Account: list audit logs
- Raw: authenticated request to any Developer API path

Base URL: `https://api.upstash.com/v2` (audit logs use `https://api.upstash.com/auditlogs`).

## Scope Notes

This connector intentionally excludes Redis database and Kafka topic CRUD — those belong to the separate `upstash` connector slug.
