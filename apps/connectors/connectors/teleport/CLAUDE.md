# CLAUDE.md

## Project Overview

`connect-teleport` is a TypeScript connector for the Teleport (Gravitational) REST API with bearer token authentication and multi-profile CLI support.

## Commands

```bash
bun install
bun run dev
bun run typecheck
bun test
bun run build
```

## Authentication

Bearer token + base URL. Configure via profile or environment:

- `TELEPORT_BASE_URL` — Teleport proxy URL
- `TELEPORT_TOKEN` — API bearer token

Docs: https://goteleport.com/docs/api/

## API Surface

33 REST operations across nodes, sessions, users, roles, access requests, tokens, audit events, and auth connectors under `/v1/*`.

## Storage

`~/.hasna/connectors/connect-teleport/profiles/`
