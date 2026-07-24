# CLAUDE.md

This file provides guidance to Claude Code when working with the Wistia connector.

## Project Overview

`@hasna/connect-wistia` is a TypeScript connector for the [Wistia Data API](https://docs.wistia.com/). It provides Bearer token authentication, multi-profile configuration, and CLI access to account, projects, medias, captions, channels, stats, and project sharings.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test src/api/client.test.ts
```

## Authentication

Bearer token authentication. Generate a token at https://wistia.com/account/api.

Credentials can be set via:
- `WISTIA_API_TOKEN` or `WISTIA_API_KEY` environment variable
- Profile configuration: `connect-wistia config set-key <token>`

Auth type for dashboard: **apikey** / **bearer** (parsed from this file).

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WISTIA_API_TOKEN` | Wistia API token (primary) |
| `WISTIA_API_KEY` | Alias for `WISTIA_API_TOKEN` |
| `WISTIA_BASE_URL` | Override API base URL (default `https://api.wistia.com`) |

## API Modules

- `account` — account details and account stats
- `projects` — project CRUD, copy, stats
- `medias` — media CRUD, copy, stats, customizations, interactive
- `captions` — caption CRUD and purchase
- `channels` — channel CRUD
- `stats` — visitors, events, media engagement
- `sharings` — project collaborator sharing

## Data Storage

```
~/.hasna/connectors/connect-wistia/
├── current_profile
└── profiles/
    └── default.json
```

## Dependencies

- commander
- chalk
