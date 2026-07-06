# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`@hasna/connect-tenable` is a TypeScript client and CLI for the Tenable Vulnerability Management
(Tenable.io) REST API. It wraps scans, workbench assets, workbench vulnerabilities, scanners,
folders, and session endpoints, with multi-profile credential management.

## Build & Run Commands

```bash
bun install
bun run dev            # run the CLI
bun run dev session    # verify credentials
bun run typecheck      # tsc --noEmit
bun run build          # build to dist/ and bin/
bun test               # run unit tests (bun:test)
bun run release        # bump patch + publish
bun run release:dry    # preview only
```

## Code Style

- TypeScript strict mode, ESM (`type: module`)
- async/await for all async operations
- Minimal dependencies: `commander`, `chalk`
- Type annotations everywhere; interfaces for API response shapes

## Project Structure

```
src/
├── api/
│   ├── client.ts        # TenableClient — HTTP + X-ApiKeys auth
│   ├── index.ts         # Tenable — high-level typed API surface
│   └── tenable.test.ts  # unit tests (mocked fetch, no network)
├── cli/
│   └── index.ts         # CLI commands
├── types/
│   └── index.ts         # Type definitions + TenableApiError
├── utils/
│   ├── config.ts        # Multi-profile credential storage
│   ├── output.ts        # CLI output formatting
│   ├── settings.ts      # User preferences
│   ├── storage.ts       # Local data storage
│   └── bulk.ts          # Bulk operation helpers
└── index.ts             # Library exports
scripts/
└── release.ts           # Release automation
```

## Authentication

Tenable.io uses API key authentication via the `X-ApiKeys` header:

```
X-ApiKeys: accessKey={accessKey};secretKey={secretKey}
```

Keys are read from `TENABLE_ACCESS_KEY` / `TENABLE_SECRET_KEY` (or a stored profile).
`TENABLE_BASE_URL` overrides the default `https://cloud.tenable.com`.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TENABLE_ACCESS_KEY` | Tenable API access key (required) |
| `TENABLE_SECRET_KEY` | Tenable API secret key (required) |
| `TENABLE_BASE_URL` | Override API base URL (optional) |

## Adding Endpoints

1. Add the request in `src/api/index.ts` (via `this.client.request`)
2. Add response types in `src/types/index.ts`
3. Wire a CLI subcommand in `src/cli/index.ts`
4. Add a focused test in `src/api/tenable.test.ts` (mock `globalThis.fetch`; never call the network)
