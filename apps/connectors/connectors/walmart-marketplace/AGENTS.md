# AGENTS.md

Guidance for AI agents working with the Walmart Marketplace connector.

## Overview

`@hasna/connect-walmart-marketplace` wraps the Walmart Marketplace REST API v3 for items, inventory, and orders.

## Authentication

API Key / OAuth token auth via `WM_SEC.ACCESS_TOKEN`. Users must also configure `WM_SVC.NAME` (`WALMART_SERVICE_NAME`). Correlation IDs default to `crypto.randomUUID()` per request unless overridden.

## Security

- No hardcoded tokens or secrets
- `.env.example` has placeholders only
- No `browser-use` dependency
- No internal references (`beepmedia`, `hasnaxyz`)

## Adding Endpoints

1. Add types in `src/types/index.ts`
2. Add API module in `src/api/`
3. Wire in `src/api/index.ts`
4. Add CLI commands in `src/cli/index.ts`
5. Add tests with mocked `fetch`
