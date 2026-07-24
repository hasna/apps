# @hasna/connect-superset

A TypeScript connector for the [Apache Superset](https://superset.apache.org/) REST API. Provides both a CLI and a programmatic API for browsing dashboards, charts, datasets, databases and SQL Lab saved queries on a self-hosted Superset instance.

Apache Superset is an open-source data exploration and visualization platform. This connector talks to its public REST API (`/api/v1/...`) using JWT authentication.

## Install

```bash
bun install
bun run build
```

## Authentication

Superset uses username/password login against a configured provider (`db` by default), returning a JWT access token and refresh token.

```bash
# Point the connector at your Superset instance and log in
connect-superset config set-url https://superset.example.com
connect-superset auth login --username analyst --password '••••••'

# Verify
connect-superset auth status
connect-superset auth whoami
```

You can also supply a pre-issued access token instead of username/password via the `SUPERSET_ACCESS_TOKEN` environment variable.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SUPERSET_BASE_URL` | Base URL of the Superset instance (required) |
| `SUPERSET_USERNAME` | Login username |
| `SUPERSET_PASSWORD` | Login password |
| `SUPERSET_PROVIDER` | Auth provider (`db` or `ldap`, default `db`) |
| `SUPERSET_ACCESS_TOKEN` | Pre-issued JWT access token (optional) |
| `SUPERSET_REFRESH_TOKEN` | Refresh token (optional) |

Environment variables override profile configuration. Copy `.env.example` to `.env` and fill in your own values.

## CLI Usage

```bash
# Dashboards
connect-superset dashboard list
connect-superset dashboard list --page-size 10 --order-column changed_on --order-direction desc
connect-superset dashboard list --filter "dashboard_title:ct:Sales"
connect-superset dashboard get 5

# Charts, datasets, databases, saved queries, queries share the same list/get shape
connect-superset chart list
connect-superset dataset get 12
connect-superset database list
connect-superset saved-query list
connect-superset query list --page-size 20

# Output formats
connect-superset dashboard list --format json
connect-superset chart list --format table
```

### Filters

`--filter` accepts `col:opr:value` clauses and may be repeated. `opr` is any
[Superset filter operator](https://superset.apache.org/docs/api/) such as `eq`,
`ct` (contains), `sw` (starts with), `gt`, `lt`, or `in`.

```bash
connect-superset chart list --filter "viz_type:eq:table" --filter "slice_name:ct:revenue"
```

## Profiles

Multiple Superset instances/accounts are supported through named profiles stored in `~/.hasna/connectors/connect-superset/profiles/`.

```bash
connect-superset profile create staging
connect-superset --profile staging config set-url https://superset.staging.example.com
connect-superset profile use staging
connect-superset profile list
```

## Programmatic API

```ts
import { Superset } from '@hasna/connect-superset';

const superset = Superset.fromEnv(); // reads SUPERSET_BASE_URL, credentials, etc.
await superset.login();

const dashboards = await superset.dashboards.list({
  pageSize: 20,
  orderColumn: 'changed_on',
  orderDirection: 'desc',
  filters: [{ col: 'dashboard_title', opr: 'ct', value: 'Sales' }],
});

console.log(dashboards.count, dashboards.result.length);

const chart = await superset.charts.get(42);
console.log(chart.slice_name);
```

## Development

```bash
bun run dev         # Run the CLI from source
bun run typecheck   # tsc --noEmit
bun test            # Run the unit tests
bun run build       # Build dist/ and bin/
```

## License

Apache-2.0
