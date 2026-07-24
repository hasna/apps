# CLAUDE.md

Guidance for working with the connect-userflow connector.

## Overview

TypeScript connector for the [Userflow REST API v2](https://userflow.com/docs/api). Product onboarding platform covering users, groups, flows, checklists, surveys, segments, features, magic links, and webhooks.

## API Details

- **Base URL**: `https://api.userflow.com`
- **Auth**: Bearer `api_key` (dashboard auth type: `api_key`)
- **Required header**: `Userflow-Version: 2024-12-12`
- **Pagination**: `limit`, `starting_after`, `ending_before`
- **Path IDs**: URL-encoded via `encodeURIComponent` (e.g. `user/1` → `user%2F1`)

## Build & Run

```bash
bun install
bun run dev -- --help
bun run build
bun run typecheck
bun test
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `USERFLOW_API_KEY` | API key (overrides profile) |

## Configuration

Profiles stored in `~/.hasna/connectors/connect-userflow/profiles/`.

```bash
connect-userflow config set-key <key>
connect-userflow config show
```

## CLI Surface

Resource groups mirror the Userflow API: `users`, `groups`, `events`, `flows`, `checklists`, `resource-centers`, `surveys`, `attributes`, `segments`, `launchers`, `banners`, `features`, `magic-links`, `signed-data-keys`, `webhooks`.

## Authentication

API key authentication only. Set via `USERFLOW_API_KEY` or `connect-userflow config set-key`.
