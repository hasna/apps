# AGENTS.md

Guidance for AI agents working with the Windmill connector.

## Overview

REST API connector for [Windmill](https://www.windmill.dev/) (`api.windmill.dev`). Bearer token auth. No browser-use dependency.

## Commands

```bash
bun install
bun run dev
bun run typecheck
bun test
bun run build
```

## Structure

```
src/
├── api/client.ts      # HTTP client
├── api/index.ts       # Windmill facade
├── cli/index.ts       # Commander CLI
├── types/index.ts     # Types
└── utils/config.ts    # Multi-profile config
```

## Auth

- Bearer token: `WINDMILL_API_KEY`
- Optional base URL: `WINDMILL_BASE_URL`
- Optional workspace: `WINDMILL_WORKSPACE`
- Config dir: `~/.hasna/connectors/windmill/`

## Security

- No hardcoded API keys
- No internal references (beepmedia, hasnaxyz, alumia)
- `.env.example` uses placeholders only
