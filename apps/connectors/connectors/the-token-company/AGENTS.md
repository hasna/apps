# AGENTS.md

## Overview

connect-the-token-company is a TypeScript CLI and library for The Token Company's LLM prompt compression API.

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
│   ├── client.ts
│   ├── compress.ts
│   └── index.ts
├── cli/index.ts
├── types/index.ts
└── utils/config.ts, output.ts
```

## Authentication

Bearer API key via `THE_TOKEN_COMPANY_API_KEY` or profile config.

## CLI

```bash
connect-the-token-company compress <text> [--aggressiveness 0.2] [--model bear-2]
connect-the-token-company raw-request --path /compress --method POST --body '{}'
connect-the-token-company config set-api-key <key>
```

## Storage

`~/.hasna/connectors/connect-the-token-company/profiles/`
