# AGENTS.md

Guidance for AI agents working with the Velum Labs connector.

## Overview

`@hasna/connect-velum-labs` — TypeScript CLI and library for the Velum Labs data lab platform API.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

Bearer API key via `VELUM_LABS_API_KEY` or profile config (`connect-velum-labs config set-key`).

## Structure

```
src/
├── api/       # HTTP client and connector class
├── cli/       # Commander CLI
├── types/     # TypeScript types
└── utils/     # Config and output helpers
```

## Security

- No hardcoded API keys
- `.env.example` uses placeholders only
- No internal references (beepmedia, hasnaxyz)
