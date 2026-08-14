# CLAUDE.md

This file provides guidance to Claude Code when working with the Unleash connector.

## Project Overview

`connect-unleash` is a TypeScript CLI and library for the [Unleash](https://www.getunleash.io/) feature flag Admin API. It uses Bearer token authentication against an instance-specific API base URL.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

Bearer token via `UNLEASH_API_KEY` or profile config (`connect-unleash config set-key <token>`).

The API base URL is instance-specific and must end with `/api`, for example:
`https://eu.app.unleash-hosted.com/my-instance/api`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `UNLEASH_API_KEY` | Admin API token |
| `UNLEASH_BASE_URL` | Instance API root (ends with `/api`) |
| `UNLEASH_PROJECT` | Default project ID (default: `default`) |

## Admin API Paths

- `GET /admin/projects/{project}/features` — list flags
- `POST /admin/projects/{project}/features` — create flag
- `GET /admin/projects/{project}/features/{name}` — get flag
- `GET /admin/events` — list events

See https://docs.getunleash.io/reference/api-unleash/admin

## CLI Examples

```bash
connect-unleash config set-key <token>
connect-unleash config set-base-url https://eu.app.unleash-hosted.com/my-instance/api
connect-unleash flags list
connect-unleash flags get my-feature
connect-unleash flags create --name my-feature --description "New flag"
connect-unleash events list --limit 50
connect-unleash request raw -m GET -p /admin/events
```

## Data Storage

Profiles stored in `~/.hasna/connectors/connect-unleash/profiles/`.
