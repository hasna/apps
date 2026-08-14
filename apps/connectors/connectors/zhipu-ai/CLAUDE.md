# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Zhipu AI (GLM) connector — TypeScript CLI and library for the Z.AI Open Platform API. Uses Bearer token authentication against `https://api.z.ai/api/paas/v4` with chat, models, and web search endpoints.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun run dev profile list
bun run dev config show
bun run dev chat "Hello" -m glm-5.2
bun run dev models
```

## Authentication

Bearer token via `ZHIPU_AI_API_KEY` environment variable or profile config at `~/.hasna/connectors/connect-zhipu-ai/`.

Dashboard auth detection: **apikey** (Bearer token).

## API Surface

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/chat/completions` | OpenAI-compatible chat |
| GET | `/models` | List models |
| GET | `/models/:id` | Get model details |
| POST | `/web_search` | Web Search API |

## Project Structure

```
src/
├── api/
│   ├── client.ts     # HTTP client with Bearer auth
│   └── index.ts      # ZhipuAi connector class
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts      # Type definitions
├── utils/
│   ├── config.ts     # Multi-profile configuration
│   └── output.ts     # CLI output formatting
└── index.ts          # Library exports
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZHIPU_AI_API_KEY` | API key (overrides profile) |
| `ZHIPU_AI_BASE_URL` | Override base URL (optional) |

## Data Storage

```
~/.hasna/connectors/connect-zhipu-ai/
├── current_profile
└── profiles/
    └── default.json
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
