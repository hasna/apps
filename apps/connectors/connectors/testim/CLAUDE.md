# CLAUDE.md

## Project Overview

connect-testim is a TypeScript connector for the [Testim.io Public API](https://github.com/testimio/public-openapi). It provides multi-profile configuration, Bearer token authentication, and CLI commands for tests, suites, and test plans.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

Bearer Token authentication. Credentials can be set via:
- Environment variable `TESTIM_API_KEY`
- Profile configuration: `testim config set-key <key>`

## API Base URL

Default: `https://api.testim.io` (no `/v1` prefix per public OpenAPI spec).

EU region: set `TESTIM_BASE_URL=https://api.eu.testim.io`.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TESTIM_API_KEY` | API key (overrides profile) |
| `TESTIM_BASE_URL` | Override API host |

## Data Storage

```
~/.hasna/connectors/testim/
├── current_profile
└── profiles/
    └── default.json
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
