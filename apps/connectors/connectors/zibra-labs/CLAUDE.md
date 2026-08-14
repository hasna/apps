# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Zibra Labs connector CLI for quant backtesting HPC — clusters, backtest jobs, and datasets via the public REST API at `https://api.zibralabs.com/v1`.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test src/api/client.test.ts
```

## Authentication

Bearer token authentication using an API key:

```typescript
'Authorization': `Bearer ${apiKey}`,
```

authType: api_key

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZIBRA_LABS_API_KEY` | API key (overrides profile) |
| `CONNECTOR_API_KEY` | API key alias (overrides profile) |
| `ZIBRA_LABS_BASE_URL` | Override base URL (default `https://api.zibralabs.com/v1`) |

## CLI Commands

| Command | Description |
|---------|-------------|
| `clusters list` | List HPC clusters (`--region`) |
| `clusters get <clusterId>` | Get cluster details |
| `backtests submit --body <json>` | Submit a backtest job |
| `backtests get <jobId>` | Get backtest job status |
| `backtests cancel <jobId> [--body <json>]` | Cancel a backtest job |
| `datasets list` | List datasets (`--asset-class`) |
| `raw -m <method> -p <path> [-q <json>] [-b <json>]` | Raw API request |
| `profile list\|use\|create\|delete\|show` | Multi-profile management |
| `config set-key\|show\|clear` | Configuration management |

Global flags: `-k/--api-key`, `-P/--profile`, `-f/--format json|pretty`, `-v/--verbose`

## Data Storage

```
~/.hasna/connectors/connect-zibra-labs/
├── current_profile
└── profiles/
    └── default.json
```

Profile JSON:
```json
{
  "apiKey": "your-key",
  "baseUrl": "https://api.zibralabs.com/v1"
}
```
