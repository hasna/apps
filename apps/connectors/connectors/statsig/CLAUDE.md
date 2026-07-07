# CLAUDE.md

This file provides guidance to Claude Code when working with the Statsig connector.

## Project Overview

`@hasna/connect-statsig` is a TypeScript connector for the [Statsig Console API](https://docs.statsig.com/console-api/introduction). It manages feature gates, experiments, dynamic configs, segments, layers, metrics, and related resources.

## Authentication

**Type:** `api_key`

Store your Statsig Console API key in the active profile or set `STATSIG_API_KEY` in the environment. Requests use the `STATSIG-API-KEY` header and `STATSIG-API-VERSION: 20240601`.

```bash
connect-statsig config set-key <your-api-key>
# or
export STATSIG_API_KEY=your-api-key
```

## Build & Run

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## API Base URL

`https://statsigapi.net/console/v1`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STATSIG_API_KEY` | Console API key (overrides profile) |
| `STATSIG_BASE_URL` | Override API base URL |

## CLI

```bash
connect-statsig gates list
connect-statsig gates get <id>
connect-statsig experiments list
connect-statsig experiments get <id>
connect-statsig config set-key <key>
connect-statsig profile list
```
