# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-trigger-dev-api-platform is a TypeScript connector for the [Trigger.dev](https://trigger.dev) management REST API (`https://api.trigger.dev`). It provides a CLI and programmatic interface for listing runs, triggering tasks, managing schedules, and executing TRQL queries.

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
connect-trigger-dev-api-platform profile list
connect-trigger-dev-api-platform profile use <name>
connect-trigger-dev-api-platform profile create <name>
connect-trigger-dev-api-platform profile delete <name>

# Configuration
connect-trigger-dev-api-platform config set-key <key>
connect-trigger-dev-api-platform config set-project-ref <ref>
connect-trigger-dev-api-platform config show
connect-trigger-dev-api-platform config clear

# Runs
connect-trigger-dev-api-platform runs list
connect-trigger-dev-api-platform runs get <runId>

# Tasks
connect-trigger-dev-api-platform tasks trigger <taskIdentifier> --payload '{"foo":"bar"}'

# Schedules
connect-trigger-dev-api-platform schedules list
connect-trigger-dev-api-platform schedules get <scheduleId>

# TRQL queries
connect-trigger-dev-api-platform query execute "SELECT run_id, status FROM runs LIMIT 10" --period 7d
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TRIGGER_SECRET_KEY` | Project secret API key (`tr_dev_*`, `tr_prod_*`, etc.) |
| `TRIGGER_PAT` | Personal access token (`tr_pat_*`) |
| `TRIGGER_PROJECT_REF` | Project reference when using PAT auth |

## Authentication

Uses Bearer token authentication. Secret keys are project-scoped; PATs require `projectRef` on requests.

Get keys from the Trigger.dev project dashboard → API Keys.

## Data Storage

```
~/.hasna/connectors/connect-trigger-dev-api-platform/
├── current_profile
└── profiles/
    └── default.json
```

Profile JSON structure:
```json
{
  "apiKey": "tr_dev_xxx",
  "projectRef": "proj_xxx"
}
```

## API Mapping

| Alumia-style command | REST endpoint |
|---------------------|---------------|
| list-items | `GET /api/v1/runs` |
| get-item | `GET /api/v3/runs/{runId}` |
| create-item | `POST /api/v1/tasks/{taskIdentifier}/trigger` |
| list-events | `GET /api/v1/schedules` |
| search | `POST /api/v1/query` |

## Code Style

- TypeScript with strict mode
- ESM modules (`type: module`)
- Thin `fetch` client — no `@trigger.dev/sdk` runtime dependency
