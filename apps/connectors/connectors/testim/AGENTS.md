# AGENTS.md

## Project Overview

connect-testim is a TypeScript connector for the Testim.io Public API with Bearer token auth and multi-profile CLI support.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

Bearer Token via `TESTIM_API_KEY` or profile config.

## Structure

```
src/
├── api/       # HTTP client and TestsApi
├── cli/       # Commander CLI
├── types/     # TypeScript types
└── utils/     # config, output
```
