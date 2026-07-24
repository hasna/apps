# AGENTS.md

Guidance for AI agents working with connect-vapi.

## Overview

TypeScript connector for the Vapi voice AI API (`https://api.vapi.ai`).

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
├── api/           # HTTP client and resource modules
├── cli/           # Commander CLI
├── types/         # TypeScript types
├── utils/         # Config and output helpers
└── index.ts       # Library exports
```

## Security

- No hardcoded API keys
- `.env.example` uses placeholders only
- Config stored in `~/.hasna/connectors/connect-vapi/`
