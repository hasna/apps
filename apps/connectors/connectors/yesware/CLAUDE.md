# CLAUDE.md

This file provides guidance to Claude Code when working with the Yesware connector.

## Project Overview

`@hasna/connect-yesware` is a TypeScript connector for the Yesware sales email tracking API. It provides Bearer token authentication, multi-profile CLI configuration, and library exports.

**Auth:** Bearer token via `YESWARE_API_KEY` or profile config.

**Base URL:** `https://api.yesware.com/v1` (override with `YESWARE_BASE_URL`).

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test src/api/client.test.ts
```

## API Endpoints

| Command | HTTP | Path |
|---------|------|------|
| listSequences | GET | /sequences |
| createSequence | POST | /sequences |
| getSequence | GET | /sequences/:id |
| listEvents | GET | /events |
| search | POST | /search |

Yesware does not publish a full OpenAPI spec; endpoint surface is derived from Yesware API documentation and verified inventory.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `YESWARE_API_KEY` | Bearer API key |
| `YESWARE_BASE_URL` | Optional API base URL override |

## Data Storage

Profiles stored in `~/.hasna/connectors/connect-yesware/profiles/`.

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
