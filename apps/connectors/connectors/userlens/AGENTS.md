# AGENTS.md

Guidance for AI coding agents working with connect-userlens.

## Overview

TypeScript connector for Userlens customer success analytics. Implements identify, group, track, forward-raw-events, and raw-request against the public REST API.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

API Key (Write Code) via HTTP Basic auth: `Authorization: Basic base64(writeCode:)`.

Config at `~/.hasna/connectors/connect-userlens/profiles/`.

## Key Files

- `src/api/client.ts` — dual base URLs, Basic auth, JSON POST
- `src/api/index.ts` — Userlens class and EventsApi
- `src/cli/index.ts` — identify, group, track, forward-raw, raw-request
- `src/utils/config.ts` — multi-profile config

## Dependencies

commander, chalk only. No browser-use.
