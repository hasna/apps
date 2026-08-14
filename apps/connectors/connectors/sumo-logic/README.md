# connect-sumo-logic

A TypeScript connector and CLI for the [Sumo Logic](https://www.sumologic.com/) REST API. Run log search jobs, manage collectors and sources, and inspect dashboards, monitors, roles, users, partitions, and fields.

## Features

- HTTP Basic authentication with an Access ID / Access Key pair
- Deployment (region) aware endpoint selection with a custom endpoint override
- Multi-profile configuration (switch between accounts/regions)
- Search Job API workflow: create → poll status → fetch messages/records
- Pretty, table, and JSON output formats
- TypeScript with strict mode, ESM, Bun runtime

## Quick Start

```bash
bun install

# Configure credentials (or set SUMOLOGIC_ACCESS_ID / SUMOLOGIC_ACCESS_KEY)
bun run dev config set-access-id <access-id>
bun run dev config set-access-key <access-key>
bun run dev config set-deployment eu   # optional, defaults to us1

# Verify
bun run dev validate
```

## Authentication

Sumo Logic uses HTTP Basic authentication built from an **Access ID** and **Access Key**.
Create an access key under **Administration → Security → Access Keys**.

Docs: https://help.sumologic.com/docs/manage/security/access-keys/

The API endpoint depends on your account's deployment (region). Set `--deployment`
(or `SUMOLOGIC_DEPLOYMENT`) to one of:

| Deployment | Endpoint |
|------------|----------|
| `us1` (default) | https://api.sumologic.com |
| `us2` | https://api.us2.sumologic.com |
| `eu`  | https://api.eu.sumologic.com |
| `au`  | https://api.au.sumologic.com |
| `ca`  | https://api.ca.sumologic.com |
| `de`  | https://api.de.sumologic.com |
| `jp`  | https://api.jp.sumologic.com |
| `in`  | https://api.in.sumologic.com |
| `fed` | https://api.fed.sumologic.com |

You can also pass a fully-qualified endpoint with `--endpoint` / `SUMOLOGIC_ENDPOINT`.

Endpoint reference: https://help.sumologic.com/docs/api/getting-started/

## CLI Structure

```bash
connect-sumo-logic [options] [command]

Global options:
  --access-id <id>          Access ID (overrides config)
  --access-key <key>        Access key (overrides config)
  -d, --deployment <dep>    Deployment/region (us1, us2, eu, au, ca, de, jp, in, fed)
  -e, --endpoint <url>      Fully-qualified API endpoint override
  -f, --format <format>     Output format (json, table, pretty)
  -p, --profile <profile>   Use a specific profile
```

### Configuration

```bash
connect-sumo-logic config set-access-id <id>
connect-sumo-logic config set-access-key <key>
connect-sumo-logic config set-deployment <deployment>
connect-sumo-logic config set-endpoint <url>
connect-sumo-logic config show
connect-sumo-logic config clear
```

### Profiles

```bash
connect-sumo-logic profile create prod --access-id XXX --access-key YYY --deployment us2 --use
connect-sumo-logic profile use prod
connect-sumo-logic profile list
connect-sumo-logic -p prod collectors list
```

### Search Jobs

```bash
# Create a job, poll status, then fetch results
connect-sumo-logic search create -q '_sourceCategory=prod/app error' \
  --from 2026-07-01T00:00:00 --to 2026-07-01T01:00:00 --time-zone UTC
connect-sumo-logic search status <jobId>
connect-sumo-logic search messages <jobId> --limit 50
connect-sumo-logic search records <jobId>
connect-sumo-logic search delete <jobId>
```

### Collectors & Sources

```bash
connect-sumo-logic collectors list
connect-sumo-logic collectors get <id>
connect-sumo-logic sources list <collectorId>
connect-sumo-logic sources get <collectorId> <sourceId>
```

### Dashboards, Content, Monitors

```bash
connect-sumo-logic dashboards get <id>
connect-sumo-logic content personal
connect-sumo-logic content folder <id>
connect-sumo-logic monitors root
connect-sumo-logic monitors get <id>
```

### Roles, Users, Partitions, Fields

```bash
connect-sumo-logic roles list
connect-sumo-logic users list
connect-sumo-logic partitions list
connect-sumo-logic fields list
```

## Programmatic Usage

```typescript
import { SumoLogic } from '@hasna/connect-sumo-logic';

const sumo = SumoLogic.fromEnv(); // reads SUMOLOGIC_ACCESS_ID / SUMOLOGIC_ACCESS_KEY / SUMOLOGIC_DEPLOYMENT

const job = await sumo.createSearchJob({
  query: '_sourceCategory=prod/app error',
  from: '2026-07-01T00:00:00',
  to: '2026-07-01T01:00:00',
  timeZone: 'UTC',
});

const status = await sumo.getSearchJobStatus(job.id);
if (status.state === 'DONE GATHERING RESULTS') {
  const messages = await sumo.getSearchJobMessages(job.id, { limit: 100 });
  console.log(messages.messages);
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SUMOLOGIC_ACCESS_ID` | Access ID (overrides profile) |
| `SUMOLOGIC_ACCESS_KEY` | Access key (overrides profile) |
| `SUMOLOGIC_DEPLOYMENT` | Deployment/region (default `us1`) |
| `SUMOLOGIC_ENDPOINT` | Fully-qualified API endpoint override |

## Development

```bash
bun install
bun run dev        # Run CLI in development
bun run build      # Build for distribution
bun run typecheck  # Type check
```

## License

Apache-2.0
