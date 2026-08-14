# AGENTS.md

Guidance for AI agents working with the Xai API Platform connector.

## Overview

`connect-xai-api-platform` wraps the Xai API Platform REST API (`api.xaiapiplatform.com`). Do not confuse with `connect-xai` (Grok LLM API at `api.x.ai`).

## Commands

```bash
bun install
bun run dev items list
bun run typecheck
bun test src/api/client.test.ts
```

## Auth

Bearer token: `XAI_API_PLATFORM_API_KEY` or profile config.

## Structure

```
src/
├── api/client.ts    # HTTP client
├── api/index.ts     # XaiApiPlatform class
├── cli/index.ts     # Commander CLI
├── types/index.ts
└── utils/config.ts  # Profiles + env
```

## Security

- No hardcoded API keys
- `.env.example` uses placeholders only
- No browser-use dependency
