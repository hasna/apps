# CLAUDE.md — Zoho Creator Connector

## Overview

`@hasna/connect-zoho-creator` wraps the Zoho Creator REST API v2.1. Auth is OAuth bearer via `Zoho-oauthtoken`.

## Commands

```bash
bun install
bun run dev          # CLI from source
bun run build
bun run typecheck
```

## Structure

- `src/api/client.ts` — HTTP transport, DC routing (`creator.zoho.com` / `.eu` / etc.), `/api/v2.1[/stage]` prefix
- `src/api/index.ts` — `ZohoCreator` class with 24 API methods
- `src/cli/index.ts` — Commander CLI (`applications`, `forms`, `reports`, `records`, `functions`)
- `src/utils/config.ts` — Profiles at `~/.hasna/connectors/zoho-creator/`

## Auth

OAuth access token stored in profile or `ZOHOCREATOR_ACCESS_TOKEN` env var. Data center and environment are configurable per profile.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZOHOCREATOR_ACCESS_TOKEN` | OAuth access token |
| `ZOHOCREATOR_DATA_CENTER` | `com`, `eu`, `in`, `com.au`, `jp`, `ca`, `sa` |
| `ZOHOCREATOR_ENVIRONMENT` | `production` or `stage` |
