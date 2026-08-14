# CLAUDE.md

Guidance for working with the Terminus connector.

## Project Overview

`connect-terminus` is a TypeScript connector for the [Terminus](https://www.terminusapp.com/) UTM and link management REST API.

## API Reference

- **Base URL**: `https://api.terminusapp.com/`
- **API Path**: `/v1/`
- **Auth**: HTTP Basic (API key as username, empty password) or `Authorization: Bearer <key>`
- **Pagination**: `page` and `items` query parameters (1–100 items per page)
- **API Docs**: https://www.terminusapp.com/apidocs

## API Modules

| Module | Description | Key Methods |
|--------|-------------|-------------|
| Projects | Terminus projects | list, get |
| Campaigns | UTM campaign values | list |
| Contents | UTM content values | list |
| Mediums | UTM medium values | list |
| Sources | UTM source values | list |
| Terms | UTM term values | list |
| Links | Tracked links | list, get, create |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TERMINUS_API_KEY` | API key (required) |
| `TERMINUS_TOKEN` | Alias for `TERMINUS_API_KEY` |
| `TERMINUS_BASE_URL` | Optional API base URL override |
| `TERMINUS_AUTH_MODE` | `basic` (default) or `bearer` |

## Dashboard Auth

Auth type: **apikey** — configure `TERMINUS_API_KEY` in the connectors dashboard.

## CLI Commands

```bash
connect-terminus project list [--page N] [--items N]
connect-terminus campaign list <projectId>
connect-terminus content list <projectId>
connect-terminus medium list <projectId>
connect-terminus source list <projectId>
connect-terminus term list <projectId>
connect-terminus link list <projectId>
connect-terminus link create <projectId> -u <url> [-d description]
connect-terminus raw <METHOD> <path> [--body json]
connect-terminus profile list|use|create|delete|show
connect-terminus config set-key|show|clear
```

## Build & Run

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```
