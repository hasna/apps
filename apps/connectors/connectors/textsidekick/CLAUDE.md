# CLAUDE.md

Guidance for working with the Sidekick (Textsidekick) connector.

## Overview

REST API connector for Sidekick — an SMS frontline assistant with knowledge-base documents, workers, messaging, and escalations.

- **API base URL:** `https://api.textsidekick.com/v1` (override via `TEXTSIDEKICK_BASE_URL`)
- **Auth:** Bearer token (`TEXTSIDEKICK_API_KEY`)
- **Docs:** https://www.textsidekick.com/

## Commands

```bash
bun install
bun run dev
bun run typecheck
bun run build
bun test src/api/client.test.ts
```

## Structure

- `src/api/client.ts` — HTTP transport (Bearer auth)
- `src/api/index.ts` — `Sidekick` class with typed endpoint methods
- `src/cli/index.ts` — Commander CLI (`documents`, `workers`, `messages`, `escalations`, `tutorials`, `phone-number`, `raw`)
- `src/utils/config.ts` — profiles at `~/.hasna/connectors/textsidekick/`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TEXTSIDEKICK_API_KEY` | API key (required) |
| `TEXTSIDEKICK_BASE_URL` | Optional API base URL override |

## Endpoints

| Resource | Methods |
|----------|---------|
| Documents | list, get, upload, delete |
| Workers | list, get, create |
| Messages | list, send |
| Escalations | list, resolve |
| Tutorials | list, get |
| Phone number | get |
