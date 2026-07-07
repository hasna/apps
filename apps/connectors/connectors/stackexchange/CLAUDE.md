# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

Stack Exchange Q&A connector CLI — search/list questions, answers, users, and
tags across any Stack Exchange site via the public API v2.3.

## Build & Run Commands

```bash
bun install       # Install dependencies
bun run dev       # Run CLI in development
bun run build     # Build for distribution
bun run typecheck # Type check
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
│   ├── client.ts  # HTTP client over api.stackexchange.com/2.3
│   └── index.ts   # StackExchange connector facade (+ fromEnv)
├── cli/
│   └── index.ts   # CLI commands
├── types/
│   └── index.ts   # TypeScript types (Question, Answer, User, Tag, Wrapper)
├── utils/
│   ├── config.ts  # Local config + env-var resolution
│   └── output.ts  # CLI output formatting
└── index.ts       # Library exports
```

## API Notes

- Base URL: `https://api.stackexchange.com/2.3`
- Every request needs a `site` param (default `stackoverflow`).
- Responses are wrapped: `{ items, has_more, quota_max, quota_remaining, ... }`.
- Errors come back as `{ error_id, error_name, error_message }`.
- Read endpoints are keyless; a registered app `key` raises the daily quota
  from 300 to 10000 requests. `access_token` is only needed for per-user writes.

## Authentication

Optional. Register an app at https://stackapps.com/apps/oauth/register to obtain
a key. No secrets are committed — see `.env.example` for placeholder variables.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STACKEXCHANGE_KEY` | App key for higher quota (optional) |
| `STACKEXCHANGE_ACCESS_TOKEN` | OAuth access token (optional) |
| `STACKEXCHANGE_SITE` | Default site slug (default: stackoverflow) |

## Data Storage

```
~/.hasna/connectors/connect-stackexchange/
└── config.json    # User preferences (site, page size)
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
