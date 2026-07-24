# GEMINI.md

This file provides guidance to Gemini when working with this repository.

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

## Project Structure

```
src/
├── api/           # API client + resource modules
├── cli/           # CLI commands
├── types/         # TypeScript types
├── utils/         # config, output, rison
└── index.ts       # Library exports
```

## Authentication

Bearer (JWT) authentication via `POST /api/v1/security/login` (username/password + provider), refreshed via `POST /api/v1/security/refresh`. Credentials set via env vars, profile config, or `connect-superset auth login`.

## Service APIs

Each resource exposes `list(options)` and `get(id)`: DashboardsApi, ChartsApi, DatasetsApi, DatabasesApi, SavedQueriesApi, QueriesApi. List endpoints accept a Rison-encoded `q` parameter built from `{page,page_size,order_column,order_direction,filters,columns}`.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SUPERSET_BASE_URL` | Base URL of the Superset instance (required) |
| `SUPERSET_USERNAME` | Login username |
| `SUPERSET_PASSWORD` | Login password |
| `SUPERSET_PROVIDER` | Auth provider (`db` or `ldap`, default `db`) |
| `SUPERSET_ACCESS_TOKEN` | Pre-issued JWT access token (optional) |
| `SUPERSET_REFRESH_TOKEN` | Refresh token (optional) |

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
