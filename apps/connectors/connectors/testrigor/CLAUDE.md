# CLAUDE.md

## Project Overview

connect-testrigor is a TypeScript connector for the TestRigor REST API. It provides a CLI and programmatic interface for managing test suites, events, and search.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test src/api/testrigor.test.ts
```

## Authentication

Bearer token (`api_key`). Set via:

- `TESTRIGOR_API_KEY` environment variable
- `connect-testrigor config set-key <key>`
- Profile configuration under `~/.hasna/connectors/testrigor/`

## API Base URL

Default: `https://api.testrigor.com/v1`

Override with `TESTRIGOR_BASE_URL` or `connect-testrigor config set-base-url <url>`.

## CLI Commands

```bash
connect-testrigor profile list
connect-testrigor config set-key <key>
connect-testrigor suites list
connect-testrigor suites get <suiteId>
connect-testrigor suites create --body '{"name":"My Suite"}'
connect-testrigor events list
connect-testrigor search --body '{"query":"login"}'
connect-testrigor request --method GET --path /suites
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TESTRIGOR_API_KEY` | API key (Bearer token) |
| `TESTRIGOR_BASE_URL` | Optional API base URL override |

## Public Docs

https://testrigor.com/docs
