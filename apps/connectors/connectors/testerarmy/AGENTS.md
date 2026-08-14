# AGENTS.md

Guidance for AI agents working with connect-testerarmy.

## Overview

TypeScript connector for the TesterArmy REST API (`https://tester.army`). Bearer auth via API key. No browser automation.

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
├── api/       # client + resource modules (projects, tests, groups, runs, webhooks)
├── cli/       # Commander CLI
├── types/
├── utils/     # config + output
└── index.ts
```

## Auth

- `TESTERARMY_API_KEY` or profile `apiKey`
- Optional `TESTERARMY_BASE_URL` or profile `baseUrl`
- Webhook triggers use secret path only (no default Bearer header)

## Security

- No hardcoded secrets
- `.env.example` uses placeholders only
- `@hasna` namespace
