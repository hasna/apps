# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-valgo is a TypeScript connector for the [Valgo API](https://api.valgo.ai/v1) — physical AI risk quantification and autonomy insurance simulations.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
bun run dev -- --help # Show CLI help
```

## API Details

- **Base URL**: `https://api.valgo.ai/v1` (configurable via `VALGO_BASE_URL`)
- **Auth**: Bearer token: `Authorization: Bearer <VALGO_API_KEY>`
- **Product**: Physical AI risk quantification, simulation, and insurance loss estimates

## API Resources

| Resource | Endpoints | Description |
|----------|-----------|-------------|
| Simulations | `/simulations` | Create and manage risk simulations |
| Routes | `/routes` | Autonomy route definitions |
| Environments | `/environments` | Simulation environments |

## Authentication

Bearer token authentication. Send the API key in the `Authorization` header:

```
Authorization: Bearer <VALGO_API_KEY>
```

Credentials can be set via environment variable, profile configuration, or the `--api-key` CLI flag.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VALGO_API_KEY` | API key (overrides profile config) |
| `VALGO_BASE_URL` | Optional API base URL override |

## CLI Commands

```bash
connect-valgo list-simulations [--query <json>]
connect-valgo get-simulation <simulationId>
connect-valgo create-simulation --data <json>
connect-valgo get-loss-estimate <simulationId>
connect-valgo list-routes [--query <json>]
connect-valgo get-route <routeId>
connect-valgo list-environments [--query <json>]
connect-valgo raw-request [--method GET] [--path /simulations] [--query <json>] [--body <json>]
connect-valgo config set-key <key>
connect-valgo config set-base-url <url>
connect-valgo profile list|use|create|delete|show
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Bun runtime
