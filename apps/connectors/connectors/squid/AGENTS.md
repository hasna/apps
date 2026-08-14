# AGENTS.md

Guidance for AI agents working with connect-squid.

## Overview

Bearer-authenticated REST connector for Squid.energy (`https://api.squid.energy/v1`).

## Commands

```bash
bun install
bun run typecheck
bun test
bun run dev network-models list
```

## Security

- No hardcoded API keys
- `.env.example` uses placeholders only
- Uses `@hasna` namespace
