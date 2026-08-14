# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-upcloud is a TypeScript connector for UpCloud's REST API (v1.3). It provides a CLI and programmatic interface for managing cloud servers, storage, and networking.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
bun test              # Run tests
```

## Authentication

UpCloud uses HTTP Basic authentication with API username and password.

Get credentials from: https://hub.upcloud.com/account/people

| Variable | Description |
|----------|-------------|
| `UPCLOUD_USERNAME` | API username (overrides profile) |
| `UPCLOUD_PASSWORD` | API password (overrides profile) |

Profile JSON structure:
```json
{
  "apiKey": "api-username",
  "apiSecret": "api-password"
}
```

## Data Storage

```
~/.hasna/connectors/connect-upcloud/
├── current_profile
└── profiles/
    └── default.json
```

## API Base URL

`https://api.upcloud.com/1.3`

## Project Structure

```
src/
├── api/
│   ├── client.ts     # HTTP client with Basic auth
│   ├── account.ts    # Account, plans, zones
│   ├── servers.ts    # Server lifecycle
│   ├── storage.ts    # Storage operations
│   ├── network.ts    # IP addresses, firewall, networks
│   └── index.ts      # UpCloud API wrapper
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts      # Type definitions
├── utils/
│   ├── config.ts     # Multi-profile configuration
│   └── output.ts     # CLI output formatting
└── index.ts          # Library exports
```

## Error Handling

UpCloud returns errors in `{ error: { error_code, error_message } }` format. The client throws `UpCloudApiError` with the parsed message.
