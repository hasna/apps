# AGENTS.md

Guidance for AI coding agents working with connect-standard-signal.

## Overview

TypeScript connector for Standard Signal API with Bearer token auth and multi-profile CLI configuration.

## Commands

```bash
bun install
bun run dev
bun run typecheck
bun test
```

## Authentication

Bearer Token. Set via `STANDARD_SIGNAL_API_KEY` or `connect-standard-signal config set-key`.

## Structure

```
src/api/     # client.ts + resource modules
src/cli/     # Commander CLI
src/types/   # config + error types
src/utils/   # config + output
```

## API Endpoints

- `GET /portfolios`, `GET /portfolios/:id`
- `GET /strategies`
- `GET /positions`
- `GET /trades`
- `GET /performance`
- Raw path escape hatch via `rawRequest()`

Base URL: `https://api.standardsignal.com/v1`
