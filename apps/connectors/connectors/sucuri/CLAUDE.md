# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this connector.

## Project Overview

`@hasna/connect-sucuri` is a TypeScript CLI and library for Sucuri's documented Scanning API.

Official API reference: https://docs.sucuri.net/website-monitoring/scanning-api/

The documented request shape is:

```text
https://[monitor domain]/scan-api.php?k=[key]&a=scan&host=[domain]&format=simple
```

Do not add undocumented `api.sucuri.net/v1`, Bearer-auth, sites, events, or search endpoints without vendor evidence.

## Build & Run Commands

```bash
bun install
bun run dev          # run the CLI from source
bun run typecheck
bun test
bun run build
```

## Code Style

- TypeScript with strict mode
- ESM modules (`type: module`)
- async/await for async operations
- Minimal dependencies: `commander`, `chalk`
- Do not print API key values or substrings

## Project Structure

```text
src/
├── api/
│   ├── client.ts       # scan-api.php client, URL building, error mapping
│   ├── index.ts        # Sucuri connector class + fromEnv()
│   └── sucuri.test.ts  # bun:test coverage with mocked fetch
├── cli/
│   └── index.ts        # Commander CLI (profile/config/scan)
├── types/
│   └── index.ts        # SucuriConfig, scan types, SucuriApiError
├── utils/
│   ├── config.ts       # Multi-profile configuration
│   └── output.ts       # CLI output formatting
└── index.ts            # Library exports
```

## API Surface

The `Sucuri` class wraps:

- `scan({ host, format? })` — requests `scan-api.php` with `k`, `a=scan`, `host`, and `format`

## Authentication

The Scanning API requires:

| Variable | Description |
|----------|-------------|
| `SUCURI_API_KEY` | Scanning API key from the monitor dashboard |
| `SUCURI_MONITOR_DOMAIN` | Monitor domain, for example `monitorx.sucuri.net` |
