# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

connect-workflow-trigger is a TypeScript connector for the WorkflowTrigger REST API. It provides a CLI and library for managing workflow triggers, listing events, and searching via Bearer token authentication.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
bun test              # Run tests

# Run specific commands
bun run dev config show
bun run dev triggers list
bun run dev triggers get <id>
bun run dev triggers create --name "My trigger"
bun run dev events list
bun run dev search --query "keyword"
bun run dev raw --path /triggers --method GET
bun run dev profile list
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Minimal dependencies: commander, chalk only
- Type annotations required everywhere

## Project Structure

```
src/
├── api/
│   ├── client.ts     # HTTP client with Bearer auth, retry, timeout
│   ├── triggers.ts   # Triggers API (list, get, create)
│   ├── events.ts     # Events API (list)
│   ├── search.ts     # Search API
│   └── index.ts      # Main Connector class
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts      # Type definitions
├── utils/
│   ├── config.ts     # Multi-profile configuration
│   └── output.ts     # CLI output formatting
├── index.ts          # Library exports
```

## API Details

- **Base URL**: `https://api.workflow-trigger.com/v1` (override with `WORKFLOW_TRIGGER_BASE_URL`)
- **Auth**: Bearer token (`Authorization: Bearer <api_key>`)
- **Endpoints**:
  - `GET /triggers` - List triggers
  - `POST /triggers` - Create a trigger
  - `GET /triggers/:id` - Get a trigger by ID
  - `GET /events` - List events
  - `POST /search` - Search

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WORKFLOW_TRIGGER_API_KEY` | API key (overrides profile) |
| `WORKFLOW_TRIGGER_TOKEN` | Token (alias for API key) |
| `WORKFLOW_TRIGGER_BASE_URL` | Custom base URL (optional) |

## CLI Global Flags

| Flag | Description |
|------|-------------|
| `-k, --api-key <key>` | Override API key for this command |
| `-p, --profile <name>` | Use specific profile |
| `-f, --format <format>` | Output format (json, pretty) |
| `-v, --verbose` | Enable debug output |

## Data Storage

```
~/.hasna/connectors/connect-workflow-trigger/
├── current_profile     # Active profile name
└── profiles/
    ├── default.json    # Default profile
    └── {name}.json     # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
