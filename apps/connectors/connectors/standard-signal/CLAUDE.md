# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-standard-signal is a TypeScript connector for the Standard Signal API with multi-profile configuration support. It provides access to portfolios, strategies, positions, trades, and performance endpoints.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

Bearer Token authentication. Credentials can be set via:
- Environment variable: `STANDARD_SIGNAL_API_KEY`
- Profile configuration: `connect-standard-signal config set-key <key>`

Optional base URL override:
- Environment variable: `STANDARD_SIGNAL_BASE_URL`
- Profile configuration: `connect-standard-signal config set-base-url <url>`

Default API base URL: `https://api.standardsignal.com/v1`

## Project Structure

```
src/
├── api/           # API client modules
│   ├── client.ts  # HTTP client with Bearer auth
│   └── index.ts   # Main connector class
├── cli/
│   └── index.ts   # CLI commands
├── types/
│   └── index.ts   # TypeScript types
├── utils/
│   ├── config.ts  # Multi-profile configuration
│   └── output.ts  # CLI output formatting
└── index.ts       # Library exports
```

## CLI Commands

```bash
connect-standard-signal portfolios list
connect-standard-signal portfolios get <id>
connect-standard-signal strategies list
connect-standard-signal positions list
connect-standard-signal trades list
connect-standard-signal performance get
connect-standard-signal raw --path /portfolios
connect-standard-signal config set-key <key>
connect-standard-signal profile list
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STANDARD_SIGNAL_API_KEY` | API key (overrides profile) |
| `STANDARD_SIGNAL_BASE_URL` | API base URL override |

## Data Storage

```
~/.hasna/connectors/connect-standard-signal/
├── current_profile
└── profiles/
    └── default.json
```
