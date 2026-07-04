# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-zenodo is a TypeScript CLI for interacting with the Zenodo REST API. It supports searching published records and managing deposit depositions (upload drafts) with Bearer token authentication.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
```

## Authentication

Bearer Token authentication for deposit endpoints. Public record search works without a token but authenticated requests allow larger page sizes.

Credentials can be set via:
- Environment variable `ZENODO_ACCESS_TOKEN`
- Profile configuration: `connect-zenodo config set-token <token>`

## API Base URLs

| Environment | Base URL |
|-------------|----------|
| Production | `https://zenodo.org/api` |
| Sandbox | `https://sandbox.zenodo.org/api` |

Override with `ZENODO_BASE_URL` or profile `baseUrl`.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZENODO_ACCESS_TOKEN` | Personal access token (overrides profile) |
| `ZENODO_BASE_URL` | API base URL override |

## Data Storage

```
~/.hasna/connectors/connect-zenodo/
├── current_profile
└── profiles/
    ├── default.json
    └── {name}.json
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
