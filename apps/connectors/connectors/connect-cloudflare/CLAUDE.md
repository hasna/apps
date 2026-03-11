# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

Cloudflare API connector CLI - A TypeScript wrapper for the Cloudflare API with multi-profile support

## Build & Run Commands

```bash
# Install dependencies
bun install

# Run CLI in development
bun run dev

# Build for distribution
bun run build

# Type check
bun run typecheck
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
├── api/           # API client modules
│   ├── client.ts  # HTTP client with authentication
│   └── index.ts   # Main connector class
├── cli/
│   └── index.ts   # CLI commands
├── types/
│   └── index.ts   # TypeScript types
├── utils/
│   ├── config.ts  # Multi-profile configuration
│   └── output.ts  # CLI output formatting
└── index.ts       # Library exports
```

## API Updates (2025-2026)

### New Workers REST API (Beta, Sep 2025)
New resource-oriented REST API with cleaner separation:
- `POST /workers/beta/workers` — create Worker (no code needed)
- `POST /workers/beta/workers/{id}/versions` — upload code as version
- `POST /scripts/{name}/deployments` — deploy a version

Workers and Versions use new `/workers/` beta endpoints; Deployments remain on `/scripts/` endpoint.

### Workers AI — New Capabilities (2026)
- **Markdown Conversion** (`env.AI.toMarkdown()`): PDF, HTML, images with `conversionOptions` (CSS selectors, language)
- **Real-time Transcription**: 10 languages via Deepgram Nova-3 on Workers AI in RealtimeKit
- REST: `POST /accounts/{id}/ai/tomarkdown`

### Browser Rendering — Rate Limit Increase (Mar 2026)
Workers Paid plans: 3 req/s → **10 req/s** (600/min). Endpoints: `/links`, `/json`, `/scrape`, `/snapshot`, `/markdown`, `/pdf`, `/screenshot`, `/content`

### Sandboxes — Real-time File Watching (Mar 2026)
`sandbox.watch(path, options)` — SSE stream backed by inotify. Events: `create`, `modify`, `delete`, `move`.

## Authentication

API Key authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-cloudflare config set-key <key>`


## Key Patterns

1. **API Client**: All API calls go through `{{SERVICE_NAME_PASCAL}}Client` which handles auth and request formatting
2. **Resource APIs**: Each resource type gets its own API class (e.g., `UsersApi`, `OrdersApi`)
3. **CLI Commands**: Commander-based with subcommands for each resource
4. **Configuration**: Stored in `~/.connect-{{CONNECTOR_NAME}}/config.json`
5. **Environment Variables**: `{{SERVICE_NAME_UPPER}}_API_KEY` for API authentication

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CLOUDFLARE_API_KEY` | API key |

## Data Storage

```
~/.connectors/connect-cloudflare/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
