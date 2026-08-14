# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

connect-traverse is a TypeScript CLI and library for the Traverse API. It provides access to RL training environments, episodes, judgments, and datasets.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Auth

authType: api_key

| Variable | Description |
|----------|-------------|
| `TRAVERSE_API_KEY` | API key (overrides profile) |
| `TRAVERSE_BASE_URL` | Optional API base URL (default: https://api.traverse.so/v1) |

## API Endpoints

- `GET /environments` — List environments
- `POST /environments` — Create environment
- `GET /environments/{id}` — Get environment
- `GET /episodes` — List episodes
- `GET /episodes/{id}` — Get episode
- `POST /episodes/{id}/judgments` — Submit judgment
- `GET /datasets` — List datasets

Help: https://traverse.so/

## CLI Examples

```bash
connect-traverse config set-key <key>
connect-traverse environments list
connect-traverse environments get <id>
connect-traverse environments create --body '{"name":"my-env"}'
connect-traverse episodes list
connect-traverse episodes get <id>
connect-traverse judgments submit <episodeId> --score 0.9
connect-traverse datasets list
connect-traverse raw-request --path /environments
connect-traverse profile list|use|create|delete|show
```

## Data Storage

```
~/.hasna/connectors/connect-traverse/
├── current_profile
└── profiles/
    └── default.json
```

Profile JSON:
```json
{
  "apiKey": "your-key",
  "baseUrl": "https://api.traverse.so/v1"
}
```
