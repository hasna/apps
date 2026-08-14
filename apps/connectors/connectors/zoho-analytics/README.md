# Zoho Analytics Connector

TypeScript API connector for [Zoho Analytics](https://www.zoho.com/analytics/) v2 REST API.

## Features

- OAuth token authentication with multi-data-center routing (com, eu, in, com.au, jp, ca, sa)
- 27 API operations: workspaces, views, tables, rows, import/export, SQL queries, folders, users, sharing, slideshows
- CLI and programmatic library interface

## Quick Start

```bash
cd connectors/zoho-analytics
bun install
export ZOHO_ANALYTICS_TOKEN=your-oauth-token
export ZOHO_ANALYTICS_ORG_ID=your-org-id
bun run dev list-workspaces
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZOHO_ANALYTICS_TOKEN` | OAuth access token |
| `ZOHO_ANALYTICS_ORG_ID` | Organization ID |
| `ZOHO_ANALYTICS_DATA_CENTER` | Data center region (default: `com`) |
| `ZOHO_ANALYTICS_BASE_URL` | Optional API base URL override |

## CLI Commands

```bash
connect-zoho-analytics list-workspaces
connect-zoho-analytics create-workspace "Sales" --description "Q3 data"
connect-zoho-analytics list-views <workspaceId>
connect-zoho-analytics run-query <workspaceId> "SELECT * FROM Sales"
connect-zoho-analytics get-org
connect-zoho-analytics config set-token <token>
connect-zoho-analytics config set-org-id <orgId>
```

## Library Usage

```typescript
import { ZohoAnalytics } from '@hasna/connect-zoho-analytics';

const api = ZohoAnalytics.fromEnv();
const workspaces = await api.listWorkspaces();
const results = await api.runQuery('workspace-id', 'SELECT * FROM Table');
```

## License

Apache-2.0
