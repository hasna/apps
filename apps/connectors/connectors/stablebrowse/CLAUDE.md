# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

connect-stablebrowse is a TypeScript connector for the StableBrowse API (stablebrowse.ai) with multi-profile configuration support. It provides CLI and programmatic access to AI browser automation tasks, sessions, end-user credential storage, and design asset extraction. It was rebuilt from the public API reference at https://docs.stablebrowse.com/api-reference/introduction.

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

# Run specific commands
bun run dev --help
bun run dev tasks list
bun run dev tasks submit "Summarize this page" --end-user user-123 --start-url https://example.com
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Minimal dependencies: commander, chalk only
- Type annotations required everywhere
- Use interfaces for all API types

## Project Structure

- `src/api/client.ts` — HTTP client (Bearer auth, URL/query building, JSON error mapping)
- `src/api/tasks.ts` — task submission, retrieval, listing, and completion polling
- `src/api/sessions.ts` — session retrieval
- `src/api/endusers.ts` — end-user credential upsert/status/revoke
- `src/api/design.ts` — design asset extraction
- `src/api/index.ts` — `StableBrowse` facade plus `raw()` escape hatch
- `src/types/index.ts` — request/response types and `StableBrowseApiError`
- `src/utils/config.ts` — profile management (`~/.hasna/connectors/connect-stablebrowse`)
- `src/utils/output.ts` — output formatting (json/table/pretty)
- `src/cli/index.ts` — commander CLI entry point

## API Notes

- Base URL: `https://api.stablebrowse.ai/v1`
- Auth: `Authorization: Bearer <STABLEBROWSE_API_KEY>`
- Tasks and design extractions are asynchronous: submission returns a `taskId`; poll `GET /tasks/{taskId}` until status is `completed`, `failed`, or `cancelled`.
- Credentials are encrypted at rest and never returned; the status endpoint only reports which platforms are configured.
