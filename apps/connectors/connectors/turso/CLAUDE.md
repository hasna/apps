# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-turso is a TypeScript connector for the [Turso Platform API](https://docs.turso.tech/api-reference/introduction). It provides a CLI and programmatic interface for managing organizations, databases, groups, and usage.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
bun test              # Run unit tests
```

## CLI Commands

```bash
# Authentication & config
connect-turso config set-key <token>       # Set API token
connect-turso config set-org <slug>        # Set organization slug
connect-turso config show                  # Show current configuration
connect-turso auth validate                # Validate API token

# Profile management
connect-turso profile list
connect-turso profile use <name>
connect-turso profile create <name>
connect-turso profile delete <name>

# Organizations
connect-turso org list

# Databases
connect-turso database list [--group <name>]
connect-turso database get <name>
connect-turso database create <name> --group <group>
connect-turso database delete <name>

# Groups
connect-turso group list

# Usage
connect-turso usage get
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TURSO_API_TOKEN` | Platform API token (overrides profile config) |
| `TURSO_ORGANIZATION` | Organization slug (overrides profile config) |

## Authentication

Uses Bearer token authentication against `https://api.turso.tech/v1`. Create a token at https://turso.tech/app/settings/tokens.

Most organization-scoped endpoints require both an API token and an organization slug. The dashboard auth layer should detect this as **bearer** auth with an additional organization field.

## Data Storage

```
~/.hasna/connectors/connect-turso/
├── current_profile
└── profiles/
    └── default.json
```

Profile JSON structure:

```json
{
  "apiKey": "your-platform-token",
  "organization": "your-org-slug"
}
```

## Project Structure

```
src/
├── api/
│   ├── client.ts          # HTTP client with Bearer auth and retry
│   ├── organizations.ts   # /v1/organizations, /v1/auth/validate
│   ├── databases.ts       # /v1/organizations/{org}/databases
│   ├── groups.ts          # /v1/organizations/{org}/groups
│   ├── usage.ts           # /v1/organizations/{org}/usage
│   └── index.ts           # Turso facade
├── cli/index.ts
├── types/index.ts
└── utils/
    ├── config.ts
    └── output.ts
```

## API Coverage

- Organizations: list
- Auth: validate token
- Databases: list, get, create, delete
- Groups: list, get
- Usage: organization billing-cycle usage
