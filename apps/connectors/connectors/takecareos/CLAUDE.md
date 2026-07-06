# CLAUDE.md

Guidance for working on the `@hasna/connect-takecareos` connector.

## Overview

TakeCareOS is a home-care agency operating system. This package is a thin, typed
wrapper over its public REST API (`https://api.takecareos.com/v1`, Bearer API-key
auth) plus a Commander-based CLI. It is stateless: the transport uses raw `fetch`
and persists nothing except opt-in local CLI profiles under
`~/.hasna/connectors/takecareos/`.

## Layout

- `src/api/client.ts` — `TakeCareOSClientTransport`: base URL, Bearer auth, `request<T>`, error mapping to `TakeCareOSApiError`.
- `src/api/index.ts` — `TakeCareOS`: typed operations (clients, caregivers, shifts, incidents, invoices, compliance) + `rawRequest` passthrough + `fromEnv()`.
- `src/types/index.ts` — config, entity interfaces, `TakeCareOSApiError`.
- `src/utils/config.ts` — profile/API-key/base-URL storage (env vars win over stored values).
- `src/utils/output.ts` — pretty/JSON output helpers.
- `src/cli/index.ts` — CLI entry (`bin` = `takecareos`).
- `src/api/client.test.ts` — `bun:test` transport tests with a mocked `fetch`.

## Commands

```bash
bun install
bun run typecheck
bun run build
bun test
bun run dev clients list   # run the CLI locally
```

## Conventions

- No secrets or internal hostnames in source or `.env.example` (placeholders only).
- No browser-use / scraper dependencies — public API only.
- Keep entity types permissive (optional fields); the upstream API evolves per agency module.
- Add new endpoints as typed methods on `TakeCareOS`; fall back to `rawRequest` for unmodelled ones.
