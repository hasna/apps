# AGENTS.md

Guidance for AI agents working with connect-textcortex.

## Overview

TypeScript CLI and library for TextCortex Hemingwai APIs (generate, summarize, rewrite, classify). Bearer token auth, multi-profile config under `~/.hasna/connectors/connect-textcortex/`.

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
├── api/
│   ├── client.ts      # HTTP client (Bearer auth)
│   ├── hemingwai.ts   # Hemingwai API methods
│   └── index.ts       # TextCortex class
├── cli/index.ts       # Commander CLI
├── types/index.ts
└── utils/config.ts, output.ts
```

## Notes

- Slug `textcortex` is distinct from `textcortexai` (different API surface).
- Hemingwai paths use trailing slashes.
- Default base URL: `https://api.textcortex.com` (not `/v1`).
