# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-datadog is a TypeScript connector for Datadog's REST API. It provides a CLI and programmatic interface for managing metrics, monitors, dashboards, SLOs, events, hosts, downtimes, synthetics, and users.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
```

## CLI Commands

```bash
# Authentication
connect-datadog config set-api-key <key>    # Set API key
connect-datadog config set-app-key <key>    # Set Application key
connect-datadog config set-site <site>      # Set Datadog site
connect-datadog config show                 # Show current config
connect-datadog config clear                # Clear config

# Profile management
connect-datadog profile list                # List profiles
connect-datadog profile use <name>          # Switch profile
connect-datadog profile create <name>       # Create profile
connect-datadog profile delete <name>       # Delete profile

# Validation
connect-datadog validate                    # Validate credentials

# Organization
connect-datadog org                         # Get organization info

# Metrics
connect-datadog metrics query -q <query>    # Query metrics
connect-datadog metrics list --from <ts>    # List active metrics
connect-datadog metrics metadata <name>     # Get metric metadata

# Events
connect-datadog events list --start <ts> --end <ts>  # List events
connect-datadog events get <id>             # Get an event
connect-datadog events create --title <t> --text <t> # Create event

# Monitors
connect-datadog monitors list               # List monitors
connect-datadog monitors get <id>           # Get a monitor
connect-datadog monitors delete <id>        # Delete a monitor
connect-datadog monitors mute <id>          # Mute a monitor
connect-datadog monitors unmute <id>        # Unmute a monitor

# Dashboards
connect-datadog dashboards list             # List dashboards
connect-datadog dashboards get <id>         # Get a dashboard
connect-datadog dashboards delete <id>      # Delete a dashboard

# SLOs
connect-datadog slos list                   # List SLOs
connect-datadog slos get <id>               # Get an SLO
connect-datadog slos delete <id>            # Delete an SLO
connect-datadog slos history <id> --from <ts> --to <ts>  # Get SLO history

# Hosts
connect-datadog hosts list                  # List hosts
connect-datadog hosts totals                # Get host totals
connect-datadog hosts mute <hostname>       # Mute a host
connect-datadog hosts unmute <hostname>     # Unmute a host

# Downtimes
connect-datadog downtimes list              # List downtimes
connect-datadog downtimes get <id>          # Get a downtime
connect-datadog downtimes create --scope <s> # Create downtime
connect-datadog downtimes delete <id>       # Delete a downtime
connect-datadog downtimes cancel-by-scope --scope <s>  # Cancel by scope

# Synthetics
connect-datadog synthetics list             # List synthetic tests
connect-datadog synthetics get <publicId>   # Get a test
connect-datadog synthetics delete <ids>     # Delete tests
connect-datadog synthetics trigger <ids>    # Trigger tests
connect-datadog synthetics results <publicId>  # Get test results

# Users
connect-datadog users list                  # List users
connect-datadog users get <id>              # Get a user
connect-datadog users me                    # Get current user
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATADOG_API_KEY` | API key (overrides profile) |
| `DATADOG_APP_KEY` | Application key (overrides profile) |
| `DATADOG_SITE` | Datadog site (e.g., datadoghq.com, datadoghq.eu) |

## Authentication

Uses DD-API-KEY and DD-APPLICATION-KEY headers. Get your keys from:
https://app.datadoghq.com/organization-settings/api-keys

Supported sites:
- datadoghq.com (US1 - default)
- us3.datadoghq.com (US3)
- us5.datadoghq.com (US5)
- datadoghq.eu (EU)
- ap1.datadoghq.com (AP1)
- ddog-gov.com (US1-FED)

## Data Storage

```
~/.hasna/connectors/connect-datadog/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

Profile JSON structure:
```json
{
  "apiKey": "xxx",
  "appKey": "xxx",
  "site": "datadoghq.com"
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
│   ├── client.ts     # HTTP client with DD-API-KEY/DD-APPLICATION-KEY auth
│   └── index.ts      # Datadog API wrapper
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

- Metrics: Query, list active, get/update metadata, submit
- Events: List, get, create
- Monitors: List, get, create, update, delete, mute, unmute
- Dashboards: List, get, create, update, delete
- SLOs: List, get, create, update, delete, history
- Hosts: List, totals, mute, unmute
- Downtimes: List, get, create, update, delete, cancel by scope
- Synthetics: List, get, create, update, delete, trigger, results
- Users: List, get, current user (v2 API)
- Organization: Get info
- Validate: Validate credentials
