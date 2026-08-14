# AGENTS.md

Guidance for AI agents working with connect-time-saved.

## Overview

TypeScript API connector for TimeSaved time analytics (`https://api.time-saved.com/v1`). Bearer token auth only — no OAuth, no browser automation.

## Commands

```bash
bun install
bun run typecheck
bun run build
bun test
bun run dev reports list
```

## Security

- No hardcoded secrets
- `.env.example` uses placeholders only
- `@hasna` namespace in package.json

## Structure

```
src/
├── api/       # client, reports, events
├── cli/       # Commander CLI
├── types/     # TypeScript types
└── utils/     # config, output
```
