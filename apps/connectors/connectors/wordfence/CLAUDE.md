# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-wordfence is a TypeScript connector for the [Wordfence API](https://api.wordfence.com/v1). It provides security scan management, event monitoring, and search for WordPress security operations.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
bun test src/api/client.test.ts
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Type annotations required everywhere

## Architecture

### Authentication

Wordfence uses Bearer token authentication:
```
Authorization: Bearer YOUR_API_KEY
```

### Base URL

```
https://api.wordfence.com/v1
```

## Project Structure

```
src/
├── api/
│   ├── client.ts     # HTTP client with Bearer auth, retry, timeout
│   ├── scans.ts      # Scan list/create/get APIs
│   ├── events.ts     # Security events API
│   ├── search.ts     # Search API
│   └── index.ts      # Main Connector class
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts      # Type definitions
├── utils/
│   ├── config.ts     # Multi-profile config (~/.hasna/connectors/connect-wordfence/)
│   └── output.ts     # CLI output formatting
└── index.ts          # Library exports
```

## API Endpoints

### Scans
- `GET /scans` — List scans
- `POST /scans` — Create a scan
- `GET /scans/:id` — Get scan details

### Events
- `GET /events` — List security events

### Search
- `POST /search` — Search Wordfence data

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WORDFENCE_API_KEY` | Wordfence API key (overrides profile) |
| `WORDFENCE_BASE_URL` | Optional API base URL override |

## CLI Commands

```bash
connect-wordfence scans list [--limit <n>] [--status <status>]
connect-wordfence scans create [--site-id <id>] [--type <type>]
connect-wordfence scans get <scanId>
connect-wordfence events list [--type <type>] [--since <timestamp>]
connect-wordfence search <query> [--type <type>]
connect-wordfence config set-key <key>
connect-wordfence config show
connect-wordfence profile list|use|create|delete|show
```
