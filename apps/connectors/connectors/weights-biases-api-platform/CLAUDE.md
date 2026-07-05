# CLAUDE.md

Guidance for Claude Code when working with the Weights & Biases API Platform connector.

## Project Overview

`@hasna/connect-weights-biases-api-platform` is a TypeScript connector for the Weights & Biases API Platform REST API. It provides multi-profile configuration, Bearer API key authentication, and CLI commands for items, events, search, and raw requests.

This connector is **distinct** from `@hasna/connect-weights-biases` (standard W&B API at `api.wandb.ai`).

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

API key authentication. Set credentials via:

- Environment variable `WEIGHTS_BIASES_API_PLATFORM_API_KEY`
- Profile config: `weights-biases-api-platform config set-key <key>`

The HTTP client sends the key as `Authorization: Bearer <api_key>`.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WEIGHTS_BIASES_API_PLATFORM_API_KEY` | API key (overrides profile) |
| `WEIGHTS_BIASES_API_PLATFORM_BASE_URL` | Override base URL (default `https://api.weightsbiasesapiplatform.com/v1`) |

## API Endpoints

| Operation | Method | Path |
|-----------|--------|------|
| List items | GET | `/items` |
| Create item | POST | `/items` |
| Get item | GET | `/items/{itemId}` |
| List events | GET | `/events` |
| Search | POST | `/search` |

## CLI Commands

```bash
weights-biases-api-platform config show
weights-biases-api-platform config set-key <key>
weights-biases-api-platform items list
weights-biases-api-platform items get <itemId>
weights-biases-api-platform items create --body '<json>'
weights-biases-api-platform events list --item-id <itemId>
weights-biases-api-platform search query --body '<json>'
weights-biases-api-platform request /items -X GET
```

## Data Storage

```
~/.hasna/connectors/weights-biases-api-platform/
├── current_profile
└── profiles/
    └── default.json
```

## Documentation

- [Weights & Biases documentation](https://docs.wandb.ai/)
- [W&B Public API overview](https://docs.wandb.ai/models/ref/python/public-api)

## Project Structure

```
src/
├── api/       # client, items, events, search
├── cli/       # Commander CLI
├── types/
└── utils/     # config, output
```
