# AGENTS.md

## Overview

`connect-userflow` is a TypeScript connector for the Userflow REST API v2 with Bearer API key auth and multi-profile configuration.

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
src/
├── api/       # HTTP client and resource modules
├── cli/       # Commander CLI
├── types/     # Config and error types
└── utils/     # config.ts, output.ts
```

## Auth

- `USERFLOW_API_KEY` environment variable
- Profile config at `~/.hasna/connectors/connect-userflow/`
- Dashboard detects `api_key` auth via CLAUDE.md

## Security

- No hardcoded secrets
- No browser-use / scraper dependencies
- Placeholder-only `.env.example`
