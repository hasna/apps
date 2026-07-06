# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-zapier-api-platform is a TypeScript connector for the Zapier API Platform. It provides items CRUD, event listing, search, and raw HTTP request access through a CLI and programmatic interface.

## API Reference

- **Base URL**: `https://api.zapierapiplatform.com/v1`
- **Auth**: Bearer token (`Authorization: Bearer <api_key>`)
- **Override**: `ZAPIER_API_PLATFORM_BASE_URL` environment variable

## API Modules

| Module | Description | Key Methods |
|--------|-------------|-------------|
| Items | Platform items | list, get, create |
| Events | Platform events | list |
| Search | Search queries | search |
| Raw | Arbitrary HTTP | request |

## Endpoints

- `GET /items` — List items
- `POST /items` — Create item
- `GET /items/:itemId` — Get item
- `GET /events` — List events
- `POST /search` — Search
- Raw request — any method/path/query/body

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZAPIER_API_PLATFORM_API_KEY` | API key (required) |
| `ZAPIER_API_PLATFORM_BASE_URL` | Override base URL (optional) |

## CLI Commands

```bash
connect-zapier-api-platform items list [--limit N] [--offset N]
connect-zapier-api-platform items get <itemId>
connect-zapier-api-platform items create -d '{"field": "value"}'
connect-zapier-api-platform events list [--limit N] [--offset N]
connect-zapier-api-platform search run -d '{"query": "..."}'
connect-zapier-api-platform raw request --path /items [-X GET] [-d '{}']
connect-zapier-api-platform profile list|use|create|delete|show
connect-zapier-api-platform config set-key|show|clear
```

## Build & Run

```bash
bun install
bun run dev
bun run build
bun run typecheck
```
