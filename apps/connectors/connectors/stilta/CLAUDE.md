# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-stilta is a TypeScript connector for the Stilta patents / prior-art research API. It provides both a CLI and a programmatic API for searching patents, retrieving patent records, and running prior-art research jobs. Authentication uses an API key with multi-profile configuration support.

## Build & Run Commands

```bash
# Install dependencies
bun install

# Run CLI in development
bun run dev

# Build for distribution
bun run build

# Type check
bun run typecheck
```

## Code Style

- TypeScript with strict mode
- ESM modules (`type: module`)
- Async/await for all async operations
- Minimal dependencies: commander, chalk
- Type annotations required everywhere

## Project Structure

```
src/
├── api/
│   ├── client.ts  # HTTP client with API key authentication
│   └── index.ts   # Stilta connector class
├── cli/
│   └── index.ts   # CLI commands
├── types/
│   └── index.ts   # TypeScript types
├── utils/
│   ├── config.ts  # Multi-profile configuration
│   └── output.ts  # CLI output formatting
└── index.ts       # Library exports
```

## API Coverage

- **Patents**: search patents (`POST /patents/search`), get a patent by id (`GET /patents/{patentId}`)
- **Research Jobs**: list jobs (`GET /research-jobs`), create a job (`POST /research-jobs`), get a job by id (`GET /research-jobs/{jobId}`)
- **Raw**: perform an arbitrary request against any Stilta API path

## Authentication

API key authentication. The key is sent in the `Authorization: Bearer <key>` header. Credentials can be set via:
- Environment variable: `STILTA_API_KEY`
- Profile configuration: `connect-stilta config set-key <key>`

The base URL defaults to `https://api.stilta.com/v1` and can be overridden with `STILTA_BASE_URL` or `connect-stilta config set-base-url <url>`.

## CLI Commands

### Patents
```bash
connect-stilta patent search --query "wireless charging" --limit 10
connect-stilta patent search --body '{"query":"solar panel","filters":{"year":2023}}'
connect-stilta patent get <patentId>
```

### Research Jobs
```bash
connect-stilta research-job list --status running
connect-stilta research-job create --type prior-art --query "battery thermal management"
connect-stilta research-job get <jobId>
```

### Raw Requests
```bash
connect-stilta raw /patents/search -X POST --body '{"query":"drone"}'
connect-stilta raw /research-jobs -q '{"limit":5}'
```

### Profile & Config
```bash
connect-stilta profile list
connect-stilta profile use <name>
connect-stilta profile create <name> --token <key> --use
connect-stilta profile delete <name>
connect-stilta profile show

connect-stilta config set-key <key>
connect-stilta config set-base-url <url>
connect-stilta config show
connect-stilta config clear
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STILTA_API_KEY` | Stilta API key (overrides profile) |
| `STILTA_BASE_URL` | Override the API base URL (optional) |

## Data Storage

```
~/.hasna/connectors/connect-stilta/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
