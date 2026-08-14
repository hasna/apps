# AGENTS.md

Guidance for AI agents working with the Transload connector.

## Overview

`@hasna/connect-transload` is a TypeScript API connector for Transload's freight dimension measurement platform. Bearer token REST API at `https://api.transload.com/v1`.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Structure

```
connectors/transload/
├── src/
│   ├── api/           # HTTP client + resource modules
│   ├── cli/           # Commander CLI
│   ├── types/         # TypeScript types
│   └── utils/         # Config and output helpers
├── package.json
├── CLAUDE.md
└── README.md
```

## Authentication

Bearer API key via `TRANSLOAD_API_KEY` env var or `connect-transload config set-key <key>`.

## Security

- No hardcoded API keys
- No internal references (beepmedia, hasnaxyz)
- `.env.example` has placeholders only
