# CLAUDE.md

Guidance for working on the Whop connector (`@hasna/connect-whop`).

## Overview

TypeScript CLI/library for the Whop REST API v1 (`https://api.whop.com/api/v1`). Uses Bearer API key auth, optional `Api-Version-Date` header, and cursor pagination (`after` / `before` / `first`).

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

API key auth (`apikey`). Set via `WHOP_API_KEY` or `connect-whop config set-key`. Many list endpoints require `WHOP_COMPANY_ID` / `biz_xxx` when using company API keys.

## Structure

```
src/api/          # WhopClient + resource modules
src/cli/          # Commander CLI
src/types/        # Shared types and WhopApiError
src/utils/        # config + output
```

## Adding endpoints

1. Add types in `src/types/index.ts`
2. Add methods to the relevant `src/api/*.ts` module
3. Wire exports in `src/api/index.ts`
4. Add CLI subcommands in `src/cli/index.ts`

## Docs

- https://docs.whop.com/developer/api/getting-started
- https://docs.whop.com/api-reference
