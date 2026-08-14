# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-usecrow is a TypeScript connector for the Crow Platform API (https://docs.usecrow.ai). It provides embedded agent chat, conversation management, recorded workflows, and remote browser-use session endpoints via HTTP.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
bun test src/api/client.test.ts
```

## API Reference

- **Base URL**: `https://api.usecrow.org`
- **Auth**: `product_id` (required) + optional `identity_token` JWT in request body or query
- **Docs**: https://docs.usecrow.ai

## API Modules

| Module | Operations |
|--------|------------|
| `chat` | sendMessage, listConversations, getConversationHistory, getAnonymousConversationHistory |
| `workflows` | listRecordedWorkflows |
| `browserUse` | start, step, end (remote HTTP API — no local browser automation) |

## CLI Commands

| Command | Description |
|---------|-------------|
| `profile list\|use\|create\|delete\|show` | Manage profiles |
| `config set-product-id\|set-identity-token\|set-base-url\|show\|clear` | Manage configuration |
| `chat send\|conversations\|history\|history-anonymous` | Chat operations |
| `workflow list` | List recorded workflows |
| `browser-use start\|step\|end` | Browser-use session operations |
| `raw` | Raw API request |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `USECROW_PRODUCT_ID` | Crow product ID (required) |
| `USECROW_IDENTITY_TOKEN` | Identity JWT (optional, required for some endpoints) |
| `USECROW_BASE_URL` | API base URL override |

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Type annotations required everywhere
