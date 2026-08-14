# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

`@hasna/connect-splunk-cloud` is a TypeScript connector for the Splunk Cloud Platform REST management API (`splunkd`, `/services/*`). It provides CLI and library access to search jobs, saved searches, indexes, HEC tokens, users, roles, messages, fired alerts, and apps.

## Build & Run Commands

```bash
bun install
bun run dev <command>   # run the CLI from source
bun run build           # bundle to dist/ and bin/
bun run typecheck       # tsc --noEmit
bun test                # bun:test unit tests
```

## Architecture

- `src/api/client.ts` — `SplunkCloudClient`: low-level HTTP. Builds URLs against a **required** base URL, always injects `output_mode=json`, applies Bearer or Basic auth, encodes write bodies as `application/x-www-form-urlencoded`, retries `429`/`5xx` with exponential backoff, and parses Splunk `{ messages: [...] }` errors.
- `src/api/index.ts` — `SplunkCloud`: high-level typed methods. Unwraps the Atom-style `{ entry: [{ content }] }` envelope for single-resource getters. `SplunkCloud.fromEnv()` reads `SPLUNK_CLOUD_*` env vars.
- `src/types/index.ts` — config, envelope, and per-resource content types plus `SplunkCloudApiError` / `parseApiError`.
- `src/utils/config.ts` — multi-profile credential store under `~/.hasna/connectors/connect-splunk-cloud`.
- `src/utils/output.ts` — pretty/table/json formatting.
- `src/cli/index.ts` — Commander CLI (`connect-splunk-cloud`).

## Conventions

- Do not hard-code any Splunk stack host — the base URL is always supplied by the caller (env, flag, or profile).
- Splunk REST endpoints are under `/services/...`; write requests are form-encoded, not JSON.
- Keep `.env.example` placeholder-only (no real hosts or secrets).
