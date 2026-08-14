# CLAUDE.md

This file provides guidance to Claude Code when working with the StackAdapt connector.

## Project Overview

`@hasna/connect-stackadapt` is a TypeScript connector for the StackAdapt programmatic advertising platform. It exposes campaign management, conversion tracker (event) reads, reporting stats, GraphQL queries, and a raw REST escape hatch.

## API Reference

- **REST base URL**: `https://api.stackadapt.com/service/v2` (read-focused reporting + legacy campaign endpoints)
- **GraphQL URL**: `https://api.stackadapt.com/graphql` (primary API for write operations)
- **Auth**: `Authorization: Bearer <api_key>` and `X-Authorization: <api_key>`
- **API key**: Account Settings → API Integration in the StackAdapt dashboard
- **Docs**: https://docs.stackadapt.com/

## API Modules

| Module | Description | Key Methods |
|--------|-------------|-------------|
| Campaigns | Campaign CRUD (REST) | list, get, create, update, search |
| Events | Conversion trackers + stats | list, get, stats |
| GraphQL | Write/advanced operations | graphql(query, variables) |
| Raw | Arbitrary REST calls | rawRequest(method, path) |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STACKADAPT_API_KEY` | API key (required) |
| `STACKADAPT_TOKEN` | Alias for API key |
| `STACKADAPT_BASE_URL` | Override REST base URL |
| `STACKADAPT_GRAPHQL_URL` | Override GraphQL endpoint |

## CLI Commands

```bash
connect-stackadapt campaign list
connect-stackadapt campaign get <id>
connect-stackadapt campaign create -n "My Campaign" -b 10000
connect-stackadapt events list
connect-stackadapt events get <id>
connect-stackadapt events stats -r campaign -t daily --id 123 --start-date 2026-01-01 --end-date 2026-01-31
connect-stackadapt search <query>
connect-stackadapt graphql -q '{ campaigns { id name } }'
connect-stackadapt raw GET /campaigns
connect-stackadapt profile list|use|create|delete|show
connect-stackadapt config set-key|show|clear
```

## Build & Run

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test src/api/client.test.ts
```

## Notes

- REST v2 write endpoints are legacy; prefer GraphQL for new campaign creation flows.
- GraphQL may require a separate API key from the REST reporting key — contact StackAdapt support if auth fails on GraphQL only.
