# @hasna/connect-tableau

A TypeScript connector and CLI for the [Tableau REST API](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api.htm). Explore workbooks, views, dashboards, data sources, projects, and users on Tableau Server or Tableau Cloud.

## Features

- Multi-profile configuration (switch between servers/sites/credentials)
- Tableau session sign-in with lazy authentication and token caching
- Personal Access Token **or** username/password authentication
- Pretty, table, and JSON output formats
- TypeScript with strict mode
- Minimal dependencies: `commander`, `chalk`

## Install

```bash
bun install
```

## Authentication

Tableau uses a sign-in flow rather than a static bearer token. The connector signs in
lazily on the first request (`POST /api/{version}/auth/signin`), caches the returned
session token, and sends it as the `X-Tableau-Auth` header on subsequent requests
scoped to `/sites/{siteId}`.

Provide **one** of the two credential methods:

| Method | Values |
|--------|--------|
| Personal Access Token (recommended) | `TABLEAU_PAT_NAME`, `TABLEAU_PAT_SECRET` |
| Username / password | `TABLEAU_USERNAME`, `TABLEAU_PASSWORD` |

Plus the server location:

| Variable | Description |
|----------|-------------|
| `TABLEAU_SERVER_URL` | Base URL, e.g. `https://10ax.online.tableau.com` (no trailing slash) |
| `TABLEAU_SITE_NAME` | Site content URL. Empty string (`""`) targets the Default site on Tableau Server. |
| `TABLEAU_API_VERSION` | Optional REST API version (defaults to a current version). |

See `.env.example` for a placeholder template.

## Usage

### Configure a profile

```bash
# Personal access token
bun run dev config set \
  --server-url https://10ax.online.tableau.com \
  --site-name my-site \
  --pat-name my-token \
  --pat-secret xxxxxxxx

# Or username / password
bun run dev config set --username me@example.com --password '...'

bun run dev config show
```

### Explore content

```bash
# Workbooks
bun run dev workbook list --page-size 100
bun run dev workbook get <workbook-id>
bun run dev workbook views <workbook-id>      # query views inside a workbook

# Views
bun run dev view list
bun run dev view get <view-id>

# Data sources, projects, users
bun run dev datasource list
bun run dev project list
bun run dev user list

# JSON output
bun run dev -f json workbook list
```

## Library usage

```typescript
import { Tableau } from '@hasna/connect-tableau';

const tableau = Tableau.fromEnv();
const { workbooks } = await tableau.listWorkbooks({ pageSize: 100 });
console.log(workbooks.workbook.map((w) => w.name));
```

## CLI Structure

```
connect-tableau [options] [command]

Options:
  -f, --format <format>    Output format (json, table, pretty)
  -p, --profile <profile>  Use a specific profile

Commands:
  profile list|use|create|delete|show   Manage configuration profiles
  config set|show|clear                  Manage connection + credentials

  workbook list                          List workbooks
  workbook get <id>                      Get a workbook
  workbook views <id>                    Query views in a workbook

  view list                              List views
  view get <id>                          Get a view

  datasource list                        List data sources
  project list                           List projects
  user list                              List users
```

## Development

```bash
bun install
bun run dev          # run the CLI
bun run typecheck    # tsc --noEmit
bun run build        # bundle dist/ + bin/
```

## Data Storage

```
~/.hasna/connectors/connect-tableau/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## License

Apache-2.0
