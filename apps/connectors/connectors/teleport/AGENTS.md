# AGENTS.md

## Overview

`@hasna/connect-teleport` — Teleport PAM/zero-trust API connector with CLI and library exports.

## Commands

```bash
bun install && bun run typecheck && bun test
```

## Auth

Bearer token at `TELEPORT_BASE_URL`. No OAuth, no browser automation.

## Structure

- `src/api/client.ts` — HTTP client (Bearer, snake_case query params)
- `src/api/index.ts` — `Teleport` class (33 methods)
- `src/cli/index.ts` — grouped CLI subcommands
- `src/utils/config.ts` — profiles at `~/.hasna/connectors/connect-teleport/`

## Security

- Placeholder-only `.env.example`
- No hardcoded secrets or internal references
