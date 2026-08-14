# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

Unpaywall open-access DOI lookup and search connector CLI — Find free full-text versions of scholarly articles by DOI or title search.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
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
├── api/
│   ├── client.ts  # HTTP client with email query param auth
│   └── index.ts   # Main connector class
├── cli/
│   └── index.ts   # CLI commands
├── types/
│   └── index.ts   # TypeScript types
├── utils/
│   ├── config.ts  # Configuration
│   └── output.ts  # CLI output formatting
└── index.ts       # Library exports
```

## API Notes

Unpaywall REST API v2 at `https://api.unpaywall.org/v2`:
- `GET /v2/:doi` — OA status and bibliographic info for a DOI
- `GET /v2/search?query=&is_oa=&page=` — Title search (50 results/page)
- Rate limit: 100,000 calls/day
- Docs: https://unpaywall.org/products/api

## Authentication

API Key authentication via required `email` query parameter. Credentials can be set via:
- Environment variable: `UNPAYWALL_EMAIL`
- CLI configuration: `connect-unpaywall config set-email <email>`

## CLI Commands

```bash
connect-unpaywall config set-email <email>
connect-unpaywall config show
connect-unpaywall config clear
connect-unpaywall get <doi>
connect-unpaywall search <query> [--oa true|false] [--page N] [-f json]
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `UNPAYWALL_EMAIL` | Email for API authentication |

## Data Storage

```
~/.hasna/connectors/connect-unpaywall/
└── config.json    # Email configuration
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
