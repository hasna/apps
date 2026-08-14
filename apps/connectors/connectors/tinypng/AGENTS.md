# AGENTS.md

Guidance for AI agents working with connect-tinypng.

## Overview

TypeScript connector for the TinyPNG (Tinify) image compression API with multi-profile CLI support.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

API Key via HTTP Basic Auth (`api:YOUR_API_KEY`). Set via `TINYPNG_API_KEY` or `tinypng config set-key`.

## Key Files

- `src/api/client.ts` — HTTP client, POST `/shrink`
- `src/api/index.ts` — `Tinypng` facade (`compressFromUrl`, `compressAndPreserveCopyright`, `compressWithStore`)
- `src/cli/index.ts` — Commander CLI with `shrink` subcommands

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TINYPNG_API_KEY` | API key |
