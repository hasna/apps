# AGENTS.md

Guidance for AI agents working with the Toast POS connector.

## Overview

`@hasna/connect-toast-pos` wraps the Toast Tab REST APIs for restaurants, menus, and orders.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

OAuth2 client-credentials (`TOAST_MACHINE_CLIENT`). Requires client ID, client secret, and restaurant external ID. See `CLAUDE.md` for dashboard auth detection.

## Security

- No hardcoded credentials
- `.env.example` contains placeholders only
- Uses `@hasna` namespace
