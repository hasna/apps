# CLAUDE.md

Guidance for working with the Wiz connector in open-connectors.

## Overview

`@hasna/connect-wiz` is a TypeScript connector for the Wiz cloud security platform REST API (`https://api.wiz.io/v1`).

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test src/api/client.test.ts
```

## Authentication

Bearer token via `WIZ_API_KEY` or profile config (`wiz config set-key`).

Optional `WIZ_BASE_URL` overrides the default API host.

## API Surface

- `listIssues` — `GET /issues`
- `createIssue` — `POST /issues`
- `getIssue` — `GET /issues/:issueId`
- `listEvents` — `GET /events`
- `search` — `POST /search`
- `rawRequest` — arbitrary path/method

## Structure

```
src/
├── api/client.ts   # HTTP client (Bearer auth)
├── api/index.ts    # Wiz class
├── cli/index.ts    # Commander CLI
├── types/index.ts  # Types + WizApiError
└── utils/config.ts # Profiles + env (wiz)
```

## Docs

https://docs.wiz.io
