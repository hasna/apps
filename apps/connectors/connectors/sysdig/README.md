# @hasna/connect-sysdig

A TypeScript connector and CLI for the [Sysdig](https://sysdig.com) REST API. Manage
Sysdig Monitor alerts, dashboards, events, and notification channels, list users and
teams, and inspect Sysdig Secure policies — from the command line or programmatically.

## Features

- Bearer token authentication against the Sysdig SaaS or on-prem REST API
- Multi-profile configuration (switch between different tokens / regions)
- Region-aware base URL resolution (us1, us2, us4, eu1, eu2, au1, me2, in1, jp1)
- Pretty, table, and JSON output formats
- TypeScript with strict mode; usable as a library or a CLI

## Install

```bash
bun install
bun run build
```

## Authentication

Find your API token in the Sysdig UI under **Settings > User Profile**. The token is
unique per-user, per-team.

```bash
connect-sysdig config set-token <your-api-token>
connect-sysdig config set-region us2        # optional, defaults to us1
connect-sysdig validate
```

You can also use environment variables:

| Variable | Description |
|----------|-------------|
| `SYSDIG_API_TOKEN` | API token (overrides profile) |
| `SYSDIG_REGION` | SaaS region: us1 (default), us2, us4, eu1, eu2, au1, me2, in1, jp1 |
| `SYSDIG_BASE_URL` | Custom base URL for on-prem installs (overrides region) |

## CLI Usage

```bash
# Identity
connect-sysdig whoami                       # Show the authenticated user
connect-sysdig validate                     # Validate credentials

# Users & teams
connect-sysdig users list
connect-sysdig users get <id>
connect-sysdig teams list
connect-sysdig teams get <id>

# Monitor alerts
connect-sysdig alerts list
connect-sysdig alerts get <id>
connect-sysdig alerts create --name "High CPU" --condition "avg(cpu.used.percent) > 90"
connect-sysdig alerts delete <id>

# Dashboards
connect-sysdig dashboards list
connect-sysdig dashboards get <id>
connect-sysdig dashboards delete <id>

# Notification channels
connect-sysdig channels list
connect-sysdig channels get <id>

# Events
connect-sysdig events list --from <ts> --to <ts>
connect-sysdig events get <id>
connect-sysdig events create --name "deploy" --description "prod release" --severity 3
connect-sysdig events delete <id>

# Secure policies
connect-sysdig policies list
connect-sysdig policies get <id>
```

Add `-f json` to any command for JSON output, or `-p <profile>` to use a specific profile.

## Library Usage

```ts
import { Sysdig } from '@hasna/connect-sysdig';

const sysdig = Sysdig.fromEnv(); // reads SYSDIG_API_TOKEN / SYSDIG_REGION / SYSDIG_BASE_URL

const me = await sysdig.getCurrentUser();
const alerts = await sysdig.listAlerts();
await sysdig.createEvent({ name: 'deploy', description: 'prod release', severity: 3 });
```

## Development

```bash
bun install
bun run dev            # run the CLI from source
bun run typecheck      # type-check
bun test               # run the client tests
bun run build          # build dist/ and bin/
```

## License

Apache-2.0
