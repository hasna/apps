# CLAUDE.md

Guidance for working with the YNAB connector.

## Project Overview

`@hasna/connect-ynab` is a TypeScript connector and CLI for the [YNAB API](https://api.ynab.com). It provides multi-profile configuration, **Bearer token** authentication (Personal Access Token), and Commander-based CLI commands.

## Build & Run

```bash
bun install
bun run dev
bun run typecheck
bun test src/api/client.test.ts
```

## Authentication

**Bearer token** — Personal Access Token from https://app.ynab.com/settings/developer

Environment variable: `YNAB_ACCESS_TOKEN`

Profiles stored in `~/.hasna/connectors/connect-ynab/profiles/`.

## API Notes

- Base URL: `https://api.ynab.com/v1`
- Responses wrap payloads in `{ data: { ... } }`
- Amounts are **milliunits** (divide by 1000 for display)
- Prefer `/plans/{plan_id}` paths; `plan_id` accepts `last-used` and `default`
- OpenAPI spec: https://api.ynab.com/papi/open_api_spec.yaml

## Project Structure

```
src/
├── api/
│   ├── client.ts   # HTTP client (Bearer auth)
│   ├── index.ts    # Ynab facade
│   └── client.test.ts
├── cli/index.ts    # CLI commands
├── types/index.ts  # Types and YnabApiError
├── utils/
│   ├── config.ts   # Profile management
│   └── output.ts   # Output formatting
└── index.ts        # Library exports
```

## Key CLI Commands

```bash
connect-ynab config set-token <token>
connect-ynab plan list
connect-ynab plan get last-used
connect-ynab account list <plan_id>
connect-ynab transaction list <plan_id> --since 2026-01-01
```
