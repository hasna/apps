# CLAUDE.md

Guidance for Claude Code when working with the Weights & Biases connector.

## Project Overview

`@hasna/connect-weights-biases` is a TypeScript connector for the [Weights & Biases REST API](https://docs.wandb.ai/). It provides multi-profile configuration, API key authentication, and CLI commands for runs, events, search, and raw requests.

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

- Environment variable `WANDB_API_KEY`
- Profile config: `weights-biases config set-key <key>`

The HTTP client sends the key as `Authorization: Bearer <api_key>`.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WANDB_API_KEY` | API key (overrides profile) |
| `WANDB_BASE_URL` | Override base URL (default `https://api.wandb.ai/v1`) |

## CLI Commands

```bash
weights-biases config show
weights-biases config set-key <key>
weights-biases runs list --entity <entity> --project <project>
weights-biases runs get <runId>
weights-biases runs create --body '<json>'
weights-biases events list --run-id <runId>
weights-biases search query --body '<json>'
weights-biases request /runs -X GET
```

## Data Storage

```
~/.hasna/connectors/weights-biases/
├── current_profile
└── profiles/
    └── default.json
```

## Project Structure

```
src/
├── api/       # client, runs, events, search
├── cli/       # Commander CLI
├── types/
└── utils/     # config, output
```
