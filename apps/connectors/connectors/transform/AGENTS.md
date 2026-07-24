# AGENTS.md

Guidance for AI agents working with the Transform connector.

## Overview

`@hasna/connect-transform` wraps the Transform data transform platform REST API with Bearer `api_key` auth.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
```

## Structure

```
src/
├── api/       # client, pipelines, events, search, raw
├── cli/       # Commander CLI
├── types/
└── utils/     # config, output
```

## Security

- No hardcoded secrets
- `.env.example` uses placeholders only
- No `browser-use` dependency
- No internal references (beepmedia, hasnaxyz)

## Auth

Bearer token via `TRANSFORM_API_KEY` or profile `apiKey`.
