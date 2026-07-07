# CLAUDE.md

Strand AI connector for the open-connectors monorepo.

## Overview

TypeScript CLI and library for the [Strand AI Platform API](https://app.strandai.com/api/v1/openapi.json). Bearer token authentication via `STRAND_API_KEY` or profile config.

## Commands

```bash
bun install
bun run dev
bun run typecheck
bun test src/api/client.test.ts
```

## Authentication

Bearer token. Set via `STRAND_API_KEY` environment variable or `connect-strand-ai config set-key <key>`. Generate keys at https://app.strandai.com/settings/api-keys.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STRAND_API_KEY` | Bearer API key (overrides profile) |
| `STRAND_BASE_URL` | Optional API base URL (default `https://app.strandai.com/api/v1`) |

## API Surface

- **Uploads**: list, get, initiate (resumable), complete
- **Predict**: estimate credits, submit Lattice inference job
- **Jobs**: get status, cancel, results URL, stream URL (SSE — use external client)
- **Samples**: expiration and restore (library methods)
- **raw-request**: arbitrary authenticated API call

## Resumable Uploads

`uploads initiate` returns `uploadUrl` — PUT slide bytes to that URL outside this connector, then call `uploads complete <id>`.

## Data Storage

Profiles at `~/.hasna/connectors/connect-strand-ai/profiles/`.
