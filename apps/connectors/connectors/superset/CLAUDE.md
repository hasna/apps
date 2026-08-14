# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-superset is a TypeScript connector for the Apache Superset REST API with JWT authentication and multi-profile configuration support. It provides both a CLI and a programmatic API for browsing dashboards, charts, datasets, databases and SQL Lab saved queries on a self-hosted Superset instance.

## Build & Run Commands

```bash
bun install       # Install dependencies
bun run dev       # Run CLI in development
bun run build     # Build for distribution
bun run typecheck # Type check
bun test          # Run unit tests
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
├── api/               # API client modules
│   ├── client.ts      # HTTP client, auth, CSRF, Rison list queries
│   ├── dashboards.ts  # Dashboards resource
│   ├── charts.ts      # Charts resource
│   ├── datasets.ts    # Datasets resource
│   ├── databases.ts   # Databases resource
│   ├── savedQueries.ts# Saved queries resource
│   ├── queries.ts     # Query records resource
│   └── index.ts       # Main Superset connector class
├── cli/
│   └── index.ts       # CLI commands
├── types/
│   └── index.ts       # TypeScript types
├── utils/
│   ├── config.ts      # Multi-profile configuration
│   ├── output.ts      # CLI output formatting
│   └── rison.ts       # Rison encoder for list `q` params
├── superset.test.ts   # Unit tests
└── index.ts           # Library exports
```

## Authentication

Bearer (JWT) authentication against a self-hosted Superset instance.

- `POST {baseUrl}/api/v1/security/login` with `{username,password,provider,refresh:true}` returns `access_token` + `refresh_token`.
- `POST {baseUrl}/api/v1/security/refresh` with `Authorization: Bearer <refresh_token>` returns a new `access_token`.
- `GET {baseUrl}/api/v1/security/csrf_token/` returns a CSRF token and session cookie, required for mutating requests.
- `GET {baseUrl}/api/v1/me/` returns the current user.

Credentials can be set via environment variables, profile configuration, or `connect-superset auth login`.

## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.hasna/connectors/connect-superset/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for a single command
- Environment variables override profile config

### Rison List Queries

Superset list endpoints accept a Rison-encoded `q` query parameter. `utils/rison.ts` encodes `{page,page_size,order_column,order_direction,filters,columns}` into Rison. Filters are `{col,opr,value}` clauses.

### Service APIs

Each resource has its own module with `list(options)` and `get(id)`:
- **DashboardsApi**, **ChartsApi**, **DatasetsApi**, **DatabasesApi**, **SavedQueriesApi**, **QueriesApi**

## CLI Commands

```bash
connect-superset config set-url <url>            # Configure the instance URL
connect-superset auth login --username u --password p
connect-superset auth status
connect-superset auth whoami
connect-superset auth logout

connect-superset dashboard list [--page-size N --order-column C --filter col:opr:value]
connect-superset dashboard get <id>
connect-superset chart list | chart get <id>
connect-superset dataset list | dataset get <id>
connect-superset database list | database get <id>
connect-superset saved-query list | saved-query get <id>
connect-superset query list | query get <id>

connect-superset profile list | use <name> | create <name> | delete <name> | show
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SUPERSET_BASE_URL` | Base URL of the Superset instance (required) |
| `SUPERSET_USERNAME` | Login username |
| `SUPERSET_PASSWORD` | Login password |
| `SUPERSET_PROVIDER` | Auth provider (`db` or `ldap`, default `db`) |
| `SUPERSET_ACCESS_TOKEN` | Pre-issued JWT access token (optional) |
| `SUPERSET_REFRESH_TOKEN` | Refresh token (optional) |

## Data Storage

```
~/.hasna/connectors/connect-superset/
├── current_profile
└── profiles/
    ├── default.json
    └── {name}.json
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
