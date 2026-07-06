# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-trigger-dev is a TypeScript connector for Trigger.dev's management API. It provides a CLI and programmatic interface for listing runs, triggering tasks, reading run events, and executing TRQL queries.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
```

## CLI Commands

```bash
# Authentication
connect-trigger-dev config set-key <key>       # Set API key
connect-trigger-dev config set-base-url <url>  # Set base URL (optional)
connect-trigger-dev config show                # Show configuration
connect-trigger-dev config clear               # Clear profile config

# Profile management
connect-trigger-dev profile list
connect-trigger-dev profile use <name>
connect-trigger-dev profile create <name>
connect-trigger-dev profile delete <name>

# Runs
connect-trigger-dev runs list
connect-trigger-dev runs get <runId>
connect-trigger-dev runs create --task my-task --payload '{"hello":"world"}'

# Events
connect-trigger-dev events list <runId>

# Search
connect-trigger-dev search --body '{"query":"SELECT run_id, status FROM runs LIMIT 10"}'

# Raw API access
connect-trigger-dev raw --path /runs -X GET
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TRIGGER_SECRET_KEY` | Secret key (overrides profile config) |
| `TRIGGER_DEV_API_KEY` | Legacy API key env var, still supported |
| `TRIGGER_DEV_BASE_URL` | API base URL (default `https://api.trigger.dev/api/v1`) |

## Authentication

Uses Bearer token authentication. Create secret keys in the Trigger.dev dashboard.

## Data Storage

```
~/.hasna/connectors/connect-trigger-dev/
├── current_profile
└── profiles/
    └── default.json
```

Profile JSON structure:
```json
{
  "apiKey": "tr_dev_xxx",
  "baseUrl": "https://api.trigger.dev/api/v1"
}
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Type annotations required everywhere

## Project Structure

```
src/
├── api/
│   ├── client.ts     # HTTP client with Bearer auth and retry
│   └── index.ts      # TriggerDev API wrapper
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

- Runs: list, get
- Tasks: trigger
- Events: list run events
- Query: execute TRQL
- Raw: generic method + path escape hatch
