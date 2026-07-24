# AGENTS.md

Guidance for AI agents working with connect-ultimate-ai.

## Overview

TypeScript connector for Zendesk Ultimate AI (`https://api.ultimate.ai/v1`): bots, events, search, and raw API access.

## Commands

```bash
bun install
bun run dev
bun run typecheck
bun test
```

## Auth

Bearer token: `ULTIMATE_AI_API_KEY` or `connect-ultimate-ai config set-key <key>`.

## CLI

- `bots list|get|create`
- `events list`
- `search`
- `raw <method> <path>`
- `config` / `profile` management
