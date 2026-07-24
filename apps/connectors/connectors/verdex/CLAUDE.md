# CLAUDE.md

Guidance for Claude Code when working with the Verdex connector.

## Project Overview

`@hasna/connect-verdex` is a TypeScript CLI and library for the [Verdex](https://verdexai.com) insurance verification API — claims, satellite verifications, portfolios, site conditions, and monitoring jobs.

## Authentication

**Bearer token** — set `VERDEX_API_KEY` or run `connect-verdex config set-key <key>`.

Optional `VERDEX_BASE_URL` overrides the default `https://api.verdexai.com/v1`.

## Build & Run

```bash
bun install
bun run dev -- claims list
bun run typecheck
bun test
bun run build
```

## API Surface

| CLI | HTTP |
|-----|------|
| `claims list` | GET /claims |
| `claims get <id>` | GET /claims/:claimId |
| `verifications create <claimId>` | POST /claims/:claimId/verifications |
| `verifications get <id>` | GET /verifications/:verificationId |
| `portfolios list` | GET /portfolios |
| `portfolios get <id>` | GET /portfolios/:portfolioId |
| `sites conditions <siteId>` | GET /sites/:siteId/conditions |
| `monitoring list` | GET /monitoring-jobs |
| `monitoring run <jobId>` | POST /monitoring-jobs/:jobId/run |
| `raw-request --path <path>` | arbitrary method/path |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VERDEX_API_KEY` | Bearer API key |
| `VERDEX_BASE_URL` | Optional API base URL |

## Config Storage

`~/.hasna/connectors/verdex/profiles/`
