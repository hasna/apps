# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-sysdig is a TypeScript connector for the Sysdig REST API (Sysdig Monitor,
Sysdig Secure, and the Sysdig Platform APIs). It provides a CLI and a programmatic
interface for managing alerts, dashboards, events, notification channels, users,
teams, and Secure policies.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
bun test              # Run tests
```

## CLI Commands

```bash
# Authentication
connect-sysdig config set-token <token>     # Set API token
connect-sysdig config set-region <region>   # Set SaaS region (us1, us2, eu1, ...)
connect-sysdig config set-base-url <url>    # Set custom base URL (on-prem)
connect-sysdig config show                  # Show current config
connect-sysdig config clear                 # Clear config

# Profile management
connect-sysdig profile list                 # List profiles
connect-sysdig profile use <name>           # Switch profile
connect-sysdig profile create <name>        # Create profile
connect-sysdig profile delete <name>        # Delete profile

# Identity
connect-sysdig validate                     # Validate credentials
connect-sysdig whoami                       # Show current user

# Users & teams
connect-sysdig users list | get <id> | me
connect-sysdig teams list | get <id>

# Monitor alerts
connect-sysdig alerts list | get <id> | create | delete <id>

# Dashboards
connect-sysdig dashboards list | get <id> | delete <id>

# Notification channels
connect-sysdig channels list | get <id>

# Events
connect-sysdig events list | get <id> | create | delete <id>

# Secure policies
connect-sysdig policies list | get <id>
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SYSDIG_API_TOKEN` | API token (overrides profile) |
| `SYSDIG_REGION` | SaaS region: us1 (default), us2, us4, eu1, eu2, au1, me2, in1, jp1 |
| `SYSDIG_BASE_URL` | Custom base URL for on-prem installs (overrides region) |

## Authentication

Uses the `Authorization: Bearer <token>` header. Get your token from the Sysdig UI
under Settings > User Profile. The token is unique per-user, per-team.

Supported SaaS regions and base URLs:

| Region | Base URL |
|--------|----------|
| us1 (default) | https://app.sysdigcloud.com |
| us2 | https://us2.app.sysdig.com |
| us4 | https://app.us4.sysdig.com |
| eu1 | https://eu1.app.sysdig.com |
| eu2 | https://eu2.app.sysdig.com |
| au1 | https://au1.app.sysdig.com |
| me2 | https://app.me2.sysdig.com |
| in1 | https://app.in1.sysdig.com |
| jp1 | https://app.jp1.sysdig.com |

For on-prem installations, set `SYSDIG_BASE_URL` to your Sysdig application address.

## Data Storage

```
~/.hasna/connectors/connect-sysdig/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

Profile JSON structure:
```json
{
  "apiToken": "xxx",
  "region": "us1",
  "baseUrl": ""
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
│   ├── client.ts       # HTTP client with Bearer auth + region resolution
│   ├── client.test.ts  # Transport / region resolution tests
│   └── index.ts        # Sysdig API wrapper
├── cli/
│   └── index.ts        # CLI commands
├── types/
│   └── index.ts        # Type definitions
├── utils/
│   ├── config.ts       # Multi-profile configuration
│   └── output.ts       # CLI output formatting
└── index.ts            # Library exports
```

## API Coverage

- Platform: current user, list/get users, list/get teams, token
- Monitor alerts: list, get, create, delete
- Monitor dashboards (v3): list, get, delete
- Notification channels: list, get
- Monitor events (v2): list, get, create, delete
- Secure policies: list, get
- Validate: validate credentials (via current user)
