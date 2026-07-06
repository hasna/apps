# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`@hasna/connect-teamtailor` is a TypeScript connector CLI for the
[Teamtailor Public API](https://docs.teamtailor.com/). Teamtailor is a
recruitment ATS; this connector manages candidates, jobs, job applications,
users, departments, locations, and recruitment stages.

The API follows the [JSON:API](https://jsonapi.org/) specification: every
resource is returned as a `{ data, included?, meta?, links? }` envelope where
each resource object has an `id`, `type`, `attributes`, and optional
`relationships`.

## API Authentication

- Base URL: `https://api.teamtailor.com/v1`
- Auth header: `Authorization: Token token=<TEAMTAILOR_API_KEY>`
- Required version header: `X-Api-Version: <YYYYMMDD>` (sent on every request;
  defaults to a stable version, overridable via `TEAMTAILOR_API_VERSION`)
- Content type for writes: `application/vnd.api+json`

## Build & Run Commands

```bash
# Install dependencies
bun install

# Run CLI in development
bun run dev

# Build for distribution
bun run build

# Type check
bun run typecheck

# Run tests
bun test
bun test src/api/teamtailor.test.ts
```

## Architecture

- `src/api/client.ts` — `TeamtailorClient`: fetch-based HTTP client that sets the
  Token auth header, the required `X-Api-Version` header, JSON:API content types,
  retries (429/5xx with backoff), and maps errors to `TeamtailorApiError`.
- `src/api/resources.ts` — `ResourceApi`: generic JSON:API CRUD wrapper
  (`list`/`get`/`create`/`update`/`delete`) reused for every resource. Handles
  `page[number]`/`page[size]` pagination, `include`, `sort`, and `filter[...]`.
- `src/api/index.ts` — `Teamtailor`: top-level class exposing one `ResourceApi`
  per resource, plus `create()` (config/env) and `fromEnv()` factories.
- `src/types/index.ts` — config types, JSON:API envelope types, and the
  `TeamtailorApiError` / `parseApiError` error model.
- `src/cli/index.ts` — Commander CLI: `profile`, `config`, and generic resource
  commands generated from a resource table.
- `src/utils/config.ts` — multi-profile config in
  `~/.hasna/connectors/connect-teamtailor/`.
- `src/utils/output.ts` — json/table/pretty output formatting.

## Code Style

- TypeScript with strict mode
- ESM modules (`type: module`)
- Use async/await for all async operations
- No secrets committed; `.env.example` holds placeholders only

## Adding a Resource

Teamtailor resources are uniform, so adding one is usually a single line in
`src/api/index.ts` (a new `ResourceApi(client, '/path', 'type')`) plus an entry
in the `RESOURCES` table in `src/cli/index.ts`.
