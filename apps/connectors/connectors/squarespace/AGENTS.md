# AGENTS.md

Guidance for AI agents working with connect-squarespace.

## Overview

TypeScript connector for Squarespace Commerce API v1.0. Bearer API key auth. No browser-use dependency.

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
├── api/           # REST client + resource modules
├── cli/           # Commander CLI
├── types/         # TypeScript types
├── utils/         # config.ts, output.ts
└── index.ts
```

## Auth

- Type: API key (Bearer)
- Env: `SQUARESPACE_API_KEY`
- Config: `~/.hasna/connectors/connect-squarespace/`

## API Base

`https://api.squarespace.com/1.0`
