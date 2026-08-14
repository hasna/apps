# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-supabase-api-platform is a TypeScript connector for the [Supabase Management API](https://supabase.com/docs/reference/api/introduction). It provides project management and raw API access through a CLI and programmatic interface.

This connector targets `https://api.supabase.com/v1` (Management API). It is distinct from `connect-supabase`, which wraps per-project REST/auth/storage APIs.

## API Reference

- **Base URL**: `https://api.supabase.com/v1`
- **Auth**: Bearer personal access token in the `Authorization` header
- **API Docs**: https://supabase.com/docs/reference/api/introduction
- **OpenAPI**: https://api.supabase.com/api/v1

## Command Mapping

| Connector Method | Management API Endpoint |
|------------------|-------------------------|
| listItems | GET /projects |
| getItem(ref) | GET /projects/{ref} |
| createItem(body) | POST /projects |
| rawRequest | Any Management API path |

The current Supabase Management OpenAPI does not define organization audit or project search endpoints. Use `rawRequest` only for documented Management API paths.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SUPABASE_API_PLATFORM_ACCESS_TOKEN` | Personal access token (required) |
| `SUPABASE_API_PLATFORM_BASE_URL` | Override base URL (optional) |

## CLI Commands

```bash
connect-supabase-api-platform items list [--query <query>]
connect-supabase-api-platform items create [-d <json>] [--query <query>]
connect-supabase-api-platform items get <projectRef>
connect-supabase-api-platform raw <path> [-m <method>] [-d <json>] [-q <query>]
connect-supabase-api-platform profile list|use|create|delete|show
connect-supabase-api-platform config set-token|set-base-url|show|clear
```

## Build & Run

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test src/api/client.test.ts
```
