# CLAUDE.md

Guidance for Claude Code when working in the `connect-talend-api-platform` connector.

## Overview

`@hasna/connect-talend-api-platform` is a TypeScript CLI + library for the
**Talend Cloud Management Console Public API** (base path `/tmc/v1.2`). It wraps
the executables (tasks/plans/promotions) and executions endpoints with a real
`fetch`-based client authenticated with a personal access token (Bearer).

The API host is region-specific:
- US: `https://api.us.cloud.talend.com/tmc/v1.2`
- EU: `https://api.eu.cloud.talend.com/tmc/v1.2`
- AP: `https://api.ap.cloud.talend.com/tmc/v1.2`

## Commands

```bash
bun install
bun run dev <command>   # run CLI from source
bun run typecheck       # tsc --noEmit
bun test                # bun:test suite
bun run build           # emit dist/ (lib) and bin/ (CLI)
```

## Structure

```
src/
├── api/
│   ├── client.ts        # TalendClient — base URL, Bearer auth, request()
│   ├── index.ts         # TalendApiPlatform — high-level operations + fromEnv()
│   └── talend.test.ts   # client + operations tests (mocked fetch)
├── cli/index.ts         # Commander CLI (profile/config/task/plan/promotion/execution)
├── types/index.ts       # config + entity types + TalendApiError
├── utils/
│   ├── config.ts        # multi-profile config (~/.hasna/connectors/…)
│   └── output.ts        # pretty/table/json formatting
└── index.ts             # library exports
```

## Conventions

- ESM, TypeScript strict mode. Dependencies limited to `commander` + `chalk`.
- All API calls go through `TalendClient.request()`; list endpoints tolerate both
  bare arrays and paginated `{ items: [...] }` envelopes (see `unwrap`).
- Credentials resolve from env first (`TALEND_API_TOKEN`, `TALEND_REGION`,
  `TALEND_BASE_URL`), then the active profile.
- Never hardcode tokens; `.env.example` holds placeholders only.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TALEND_API_TOKEN` | Personal access token (required) |
| `TALEND_REGION` | `us`, `eu`, or `ap` (default `us`) |
| `TALEND_BASE_URL` | Full API base URL override |
