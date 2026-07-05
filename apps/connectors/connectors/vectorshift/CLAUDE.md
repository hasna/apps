# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`connect-vectorshift` is a TypeScript connector for the VectorShift REST API. It supports listing and running pipelines, listing and running chatbots, and creating chatbots. Authentication uses Bearer tokens (API keys from the VectorShift dashboard).

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test src/api/client.test.ts
```

## API Surface

Base URL: `https://api.vectorshift.ai/v1`

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/pipelines` | List pipelines |
| POST | `/pipeline/{id}/run` | Run a pipeline |
| GET | `/chatbots` | List chatbots |
| POST | `/chatbot/{id}/run` | Run a chatbot |
| POST | `/chatbot` | Create a chatbot |

Public docs: https://docs.vectorshift.ai/api-reference/overview

## Authentication

Bearer token in `src/api/client.ts`:

```typescript
Authorization: `Bearer ${this.apiKey}`
```

Dashboard auth detection expects API key / bearer auth in this connector's CLAUDE.md.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VECTORSHIFT_API_KEY` | API key (overrides profile) |

## Data Storage

```
~/.hasna/connectors/connect-vectorshift/
├── current_profile
└── profiles/
    └── default.json
```

Profile JSON: `{ "apiKey": "..." }`

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
