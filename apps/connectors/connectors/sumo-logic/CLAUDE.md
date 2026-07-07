# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-sumo-logic is a TypeScript connector for the Sumo Logic REST API. It provides a
CLI and programmatic interface for running log search jobs and managing collectors,
sources, dashboards, content, monitors, roles, users, partitions, and fields.

Reference: https://help.sumologic.com/docs/api/

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
```

## CLI Commands

```bash
# Authentication / configuration
connect-sumo-logic config set-access-id <id>       # Set Access ID
connect-sumo-logic config set-access-key <key>     # Set Access key
connect-sumo-logic config set-deployment <dep>     # Set deployment/region
connect-sumo-logic config set-endpoint <url>       # Set endpoint override
connect-sumo-logic config show                     # Show current config
connect-sumo-logic config clear                    # Clear config

# Profiles
connect-sumo-logic profile list                    # List profiles
connect-sumo-logic profile use <name>              # Switch profile
connect-sumo-logic profile create <name>           # Create profile
connect-sumo-logic profile delete <name>           # Delete profile

# Validation
connect-sumo-logic validate                        # Validate credentials

# Search jobs
connect-sumo-logic search create -q <q> --from <t> --to <t>  # Create a search job
connect-sumo-logic search status <jobId>           # Poll job status
connect-sumo-logic search messages <jobId>         # Fetch raw messages
connect-sumo-logic search records <jobId>          # Fetch aggregate records
connect-sumo-logic search delete <jobId>           # Delete/cancel a job

# Collectors & sources
connect-sumo-logic collectors list                 # List collectors
connect-sumo-logic collectors get <id>             # Get a collector
connect-sumo-logic collectors delete <id>          # Delete a collector
connect-sumo-logic sources list <collectorId>      # List sources
connect-sumo-logic sources get <collectorId> <id>  # Get a source

# Dashboards / content / monitors
connect-sumo-logic dashboards get <id>             # Get a dashboard (v2)
connect-sumo-logic content personal                # Get personal folder
connect-sumo-logic content folder <id>             # Get a content folder
connect-sumo-logic content path <id>               # Get content path
connect-sumo-logic monitors root                   # Get monitors root folder
connect-sumo-logic monitors get <id>               # Get a monitor

# Roles / users / partitions / fields
connect-sumo-logic roles list                      # List roles
connect-sumo-logic users list                      # List users
connect-sumo-logic partitions list                 # List partitions
connect-sumo-logic fields list                     # List custom fields
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SUMOLOGIC_ACCESS_ID` | Access ID (overrides profile) |
| `SUMOLOGIC_ACCESS_KEY` | Access key (overrides profile) |
| `SUMOLOGIC_DEPLOYMENT` | Deployment/region (default `us1`) |
| `SUMOLOGIC_ENDPOINT` | Fully-qualified API endpoint override |

## Authentication

Uses HTTP Basic auth built from an Access ID and Access Key. Create an access key at:
Administration → Security → Access Keys.

Endpoint is selected by deployment (region):
- us1 (default) → https://api.sumologic.com
- us2 → https://api.us2.sumologic.com
- eu / au / ca / de / jp / in / fed → https://api.{dep}.sumologic.com

Reference: https://help.sumologic.com/docs/api/getting-started/

## Data Storage

```
~/.hasna/connectors/connect-sumo-logic/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

Profile JSON structure:
```json
{
  "accessId": "xxx",
  "accessKey": "xxx",
  "deployment": "us1",
  "endpoint": "https://api.sumologic.com"
}
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Type annotations required everywhere

## Project Structure

```
src/
├── api/
│   ├── client.ts     # HTTP client with Basic auth + cookie affinity for search jobs
│   └── index.ts      # SumoLogic API wrapper
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts      # Type definitions
├── utils/
│   ├── config.ts     # Multi-profile configuration
│   └── output.ts     # CLI output formatting
└── index.ts          # Library exports
```

## API Coverage

- Search Jobs (v1): create, status, messages, records, delete
- Collectors (v1): list, get, delete
- Sources (v1): list, get
- Dashboards (v2): get
- Content (v2): folder, personal folder, path, resolve by path
- Monitors (v1): root, get
- Roles (v1): list, get
- Users (v1): list, get
- Partitions (v1): list, get
- Fields (v1): list, get
- Validate: lightweight credential check via collectors endpoint

## Notes

- The Search Job API relies on session affinity. The client captures `Set-Cookie`
  responses and replays them on subsequent requests so status/results calls hit the
  same backend as the create call.
