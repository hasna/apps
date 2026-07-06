# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-vultr is a TypeScript connector for Vultr's REST API v2. It provides a CLI and programmatic interface for managing cloud instances, block storage, firewalls, SSH keys, and snapshots.

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
connect-vultr config set-key <key>   # Set API key
connect-vultr config show            # Show current config
connect-vultr config clear           # Clear config

# Profile management
connect-vultr profile list           # List profiles
connect-vultr profile use <name>     # Switch profile
connect-vultr profile create <name>  # Create profile
connect-vultr profile delete <name>  # Delete profile

# Account & Infrastructure
connect-vultr account                # Get account info
connect-vultr regions                # List regions
connect-vultr plans                  # List plans

# Instances
connect-vultr instance list          # List instances
connect-vultr instance get <id>      # Get instance details
connect-vultr instance create        # Create instance
connect-vultr instance delete <id>   # Delete instance
connect-vultr instance reboot <id>   # Reboot instance
connect-vultr instance halt <id>     # Halt instance
connect-vultr instance start <id>    # Start instance

# SSH Keys
connect-vultr ssh-key list           # List SSH keys
connect-vultr ssh-key get <id>       # Get key details
connect-vultr ssh-key create         # Create SSH key
connect-vultr ssh-key delete <id>    # Delete SSH key

# Snapshots
connect-vultr snapshot list          # List snapshots
connect-vultr snapshot get <id>      # Get snapshot details
connect-vultr snapshot create        # Create snapshot
connect-vultr snapshot delete <id>   # Delete snapshot

# Block Storage
connect-vultr block list             # List block storage
connect-vultr block get <id>         # Get block details
connect-vultr block create           # Create block storage
connect-vultr block delete <id>      # Delete block storage
connect-vultr block attach <id> <instanceId>  # Attach to instance
connect-vultr block detach <id>      # Detach from instance

# Firewalls
connect-vultr firewall list          # List firewall groups
connect-vultr firewall get <id>      # Get firewall group
connect-vultr firewall create        # Create firewall group
connect-vultr firewall delete <id>   # Delete firewall group
connect-vultr firewall rules <id>    # List firewall rules
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VULTR_API_KEY` | API key (overrides profile) |

## Authentication

Uses Bearer token authentication. Get your API key from:
https://my.vultr.com/settings/#settingsapi

## Data Storage

```
~/.hasna/connectors/connect-vultr/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

Profile JSON structure:
```json
{
  "apiKey": "your-api-key"
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
│   ├── client.ts     # HTTP client with Bearer auth
│   └── index.ts      # Vultr API wrapper
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

- Account: Get account info
- Regions: List
- Plans: List
- Instances: List, get, create, delete, reboot, halt, start
- SSH Keys: List, get, create, delete
- Snapshots: List, get, create, delete
- Block Storage: List, get, create, delete, attach, detach
- Firewalls: List, get, create, delete, list rules

Base URL: `https://api.vultr.com/v2`
Pagination: cursor + per_page via meta.links
