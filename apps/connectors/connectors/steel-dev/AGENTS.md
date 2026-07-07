# AGENTS.md

Guidance for AI agents working with connect-steel-dev.

## Overview

TypeScript connector for the Steel cloud browser API (sessions, events, scrape).

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
```

## Auth

- Header: `steel-api-key: <STEEL_API_KEY>`
- Env: `STEEL_API_KEY`
- Profiles: `~/.hasna/connectors/connect-steel-dev/profiles/`

## API Base

`https://api.steel.dev/v1`

## Docs

- https://docs.steel.dev/overview/authentication
- https://docs.steel.dev/overview/sessions-api/overview
- https://docs.steel.dev/overview/browser-tools/overview
