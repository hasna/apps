# AGENTS.md

Guidance for AI agents working with the Unifold connector.

## Overview

connect-unifold is a TypeScript connector for the Unifold cross-chain deposit API with multi-profile configuration support.

## Quick Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

Bearer Token authentication via `UNIFOLD_API_KEY` or `connect-unifold config set-key <key>`.

## API Base URL

Default: `https://api.unifold.io/v1`

Override with `UNIFOLD_BASE_URL` environment variable or `connect-unifold config set-base-url <url>`.

## Security

- No hardcoded API keys
- No internal references (beepmedia, hasnaxyz)
- Uses `@hasna` namespace
- `.env.example` has placeholders only
