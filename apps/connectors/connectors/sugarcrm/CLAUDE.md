# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-sugarcrm is a TypeScript connector for the SugarCRM REST API (v11_24). It provides module CRUD, search/filter, related records, metadata, and OAuth2 password-grant authentication.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
```

## API Reference

- **Base URL**: `{instance}/rest/v11_24` (instance URL is configurable per deployment)
- **Auth**: `OAuth-Token` header with OAuth2 access token (not Bearer)
- **Token exchange**: `POST /oauth2/token` with password grant (`client_id` defaults to `sugar`)
- **Docs**: https://support.sugarcrm.com/Documentation/Sugar_Developer/

## API Modules

| Module | Operations |
|--------|------------|
| `modules` | list, get, create, update, delete, search, filter, listAccounts/Contacts/Leads/Opportunities/Cases |
| `related` | create, list, unlink |
| `metadata` | getMetadata, getModuleMetadata, getEnumOptions |
| `auth` | authenticate, logout |
| `user` | getCurrentUser, ping |

## CLI Commands

| Command | Description |
|---------|-------------|
| `profile list\|use\|create\|delete\|show` | Manage profiles |
| `config set-token\|set-base-url\|set-client-id\|set-client-secret\|show\|clear` | Manage configuration |
| `auth authenticate` | Password grant token exchange |
| `record list\|get\|create\|update\|delete\|search\|filter` | Generic module operations |
| `related list\|create\|unlink` | Related record links |
| `metadata list\|module\|enum` | Metadata and enum options |
| `user me` | Current user |
| `ping` | Instance health check |
| `logout` | Invalidate OAuth token |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SUGARCRM_OAUTH_TOKEN` | OAuth2 access token (overrides profile) |
| `SUGARCRM_BASE_URL` | SugarCRM instance URL (e.g. `https://yourcompany.sugarondemand.com`) |
| `SUGARCRM_CLIENT_ID` | Optional OAuth2 client ID for password grant |
| `SUGARCRM_CLIENT_SECRET` | Optional OAuth2 client secret |

## Dashboard Auth

Auth type: **apikey** with fields:
- `oauth_token` (secret, required) — OAuth2 access token
- `base_url` (required) — SugarCRM instance URL

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Type annotations required everywhere
