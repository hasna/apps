# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-voxel-energy is a TypeScript connector for the Voxel Energy REST API. It provides a CLI and programmatic interface for managing off-grid data center sites, power profiles, capacity, and GPU reservations.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
bun test              # Run unit tests
```

## CLI Commands

```bash
# Authentication
connect-voxel-energy config set-key <key>       # Set API key
connect-voxel-energy config set-base-url <url>  # Set custom base URL
connect-voxel-energy config show                # Show current config
connect-voxel-energy config clear               # Clear config

# Profile management
connect-voxel-energy profile list               # List profiles
connect-voxel-energy profile use <name>         # Switch profile
connect-voxel-energy profile create <name>      # Create profile
connect-voxel-energy profile delete <name>      # Delete profile

# Sites
connect-voxel-energy sites list                 # List sites
connect-voxel-energy sites get <siteId>         # Get site details
connect-voxel-energy sites power-profile <siteId>  # Get power profile
connect-voxel-energy sites capacity <siteId>    # Get capacity

# Reservations
connect-voxel-energy reservations list          # List reservations
connect-voxel-energy reservations get <id>      # Get reservation
connect-voxel-energy reservations create -b '{}'  # Create reservation

# Raw API access
connect-voxel-energy raw -p /sites -m GET       # Raw request
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VOXEL_ENERGY_API_KEY` | API key (overrides profile) |
| `VOXEL_ENERGY_BASE_URL` | Override base URL (default https://api.voxelenergy.com/v1) |

## Authentication

Auth type: **api_key** (Bearer token).

Get your API key from the Voxel Energy dashboard. Requests use `Authorization: Bearer <api_key>`.

## Data Storage

```
~/.hasna/connectors/connect-voxel-energy/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

Profile JSON structure:
```json
{
  "apiKey": "your-api-key",
  "baseUrl": "https://api.voxelenergy.com/v1"
}
```

## Project Structure

```
src/
├── api/
│   ├── client.ts     # HTTP client with Bearer auth
│   ├── client.test.ts
│   └── index.ts      # VoxelEnergy API wrapper
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

- Sites: list, get, power-profile, capacity
- Reservations: list, get, create
- Raw requests: custom path, method, query, body

Path segments with special characters are URL-encoded via `encodeURIComponent`.
