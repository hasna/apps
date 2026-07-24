# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this connector.

## Project Overview

`@hasna/connect-stitch-data` is a TypeScript connector CLI and SDK for [Stitch](https://www.stitchdata.com),
built on the public [Stitch Connect API](https://www.stitchdata.com/docs/developers/stitch-connect/api) (v4).
It manages sources, destinations, streams, and replication jobs, and reports on extractions and loads.

## Build & Run Commands

```bash
bun install            # install dependencies
bun run dev            # run the CLI in development
bun run build          # build dist/ (SDK) and bin/ (CLI)
bun run typecheck      # tsc --noEmit
bun test               # run unit tests
```

## Architecture

- `src/api/client.ts` — `StitchClient`: Bearer auth, URL/query building, JSON parsing,
  retry-with-backoff on 429 and 5xx, `StitchApiError`.
- `src/api/*.ts` — one class per resource group: `SourcesApi`, `DestinationsApi`,
  `SourceTypesApi`/`DestinationTypesApi`, `StreamsApi`, `ReplicationApi`, `ReportingApi`.
- `src/api/index.ts` — `Stitch` facade wiring the resource APIs; `Stitch.fromEnv()`.
- `src/cli/index.ts` — Commander-based CLI. Global flags: `--api-key`, `--client-id`,
  `--base-url`, `--format`, `--verbose`, `--profile`.
- `src/types/index.ts` — request/response and config types, `StitchApiError`.
- `src/utils/config.ts` — multi-profile credential storage under
  `~/.hasna/connectors/connect-stitch-data/`.
- `src/utils/output.ts` — `json` / `table` / `pretty` formatters.

## Authentication

Uses a non-expiring Stitch Connect API access token sent as `Authorization: Bearer <token>`.
Resolution order: CLI `--api-key` → `STITCH_ACCESS_TOKEN` env → active profile.
Reporting endpoints (extractions/loads) also require a client id
(`--client-id` → `STITCH_CLIENT_ID` → profile).

## Code Style

- TypeScript strict mode, ESM modules (`type: module`).
- Async/await throughout; no secrets committed — `.env.example` holds placeholders only.
