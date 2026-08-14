# CLAUDE.md

This file provides guidance to Claude Code when working with the connect-squid connector.

## Project Overview

connect-squid is a TypeScript connector for the Squid.energy REST API. It provides a CLI and library for network models, assets, workflows, and workflow runs.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test

bun run dev network-models list
bun run dev network-models get <modelId>
bun run dev assets list
bun run dev workflows list
bun run dev workflow-runs create --workflow-id <id>
bun run dev raw request --path /network-models
```

## API Details

- **Base URL**: `https://api.squid.energy/v1`
- **Auth**: Bearer token (`Authorization: Bearer <api_key>`)
- **Endpoints**:
  - `GET /network-models` — list network models
  - `GET /network-models/{modelId}` — get network model
  - `GET /network-models/{modelId}/versions` — list model versions
  - `GET /assets` — list assets
  - `GET /workflows` — list workflows
  - `POST /workflow-runs` — create workflow run

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SQUID_API_KEY` | API key (overrides profile) |
| `SQUID_BASE_URL` | Optional API base URL override |

## Data Storage

```
~/.hasna/connectors/connect-squid/
├── current_profile
└── profiles/
    └── default.json
```

Profile JSON stores `apiKey` and optional `baseUrl`.
