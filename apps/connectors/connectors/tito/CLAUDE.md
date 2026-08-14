# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-tito is a TypeScript connector for the Tito (ti.to) Admin REST API v3. It provides a CLI and library for managing event registrations, tickets, releases, and check-in lists.

Documentation: https://ti.to/docs/api/admin/3.1

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun run dev -- hello
bun run dev -- tickets list --account my-org --event my-event
```

## API Details

- **Base URL**: `https://api.tito.io/v3`
- **Auth**: Rails-style token header `Authorization: Token token=<api_token>` (unquoted)
- **Event scope**: Most endpoints require `/{accountSlug}/{eventSlug}/...` path segments (URL-encoded)

## Authentication

API key authentication via Tito Admin API token. Set `TITO_API_TOKEN` or use `connect-tito config set-key <token>`.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TITO_API_TOKEN` | Tito Admin API token (overrides profile config) |

## CLI Commands

```bash
connect-tito hello
connect-tito tickets list --account <slug> --event <slug>
connect-tito tickets get <ticketSlug> --account <slug> --event <slug>
connect-tito registrations list --account <slug> --event <slug>
connect-tito registrations get <registrationSlug> --account <slug> --event <slug>
connect-tito releases list --account <slug> --event <slug>
connect-tito checkin-lists list --account <slug> --event <slug>
connect-tito config set-key <token>
connect-tito profile list
```

## Data Storage

Profiles stored in `~/.hasna/connectors/tito/profiles/`.

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Bun runtime
