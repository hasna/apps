# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-voygr is a TypeScript connector for the VOYGR place and business validation API at `https://dev.voygr.tech`.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

- **Signup / Recover**: No authentication required
- **Business status / Usage**: `X-API-Key` header

## API Endpoints

| Command | Method | Path | Auth |
|---------|--------|------|------|
| signup | POST | `/signup` | No |
| recover | POST | `/recover` | No |
| check-business-status | POST | `/v1/business-status` | X-API-Key |
| get-usage | GET | `/v1/usage` | X-API-Key |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VOYGR_API_KEY` | API key |
| `VOYGR_BASE_URL` | Override base URL |

## Project Structure

```
src/
├── api/
│   ├── client.ts       # HTTP client with X-API-Key auth
│   ├── client.test.ts  # Mock-fetch unit tests
│   └── index.ts        # Voygr connector class
├── cli/
│   └── index.ts        # CLI commands
├── types/
│   └── index.ts
├── utils/
│   ├── config.ts       # ~/.hasna/connectors/connect-voygr/
│   └── output.ts
└── index.ts
```

## CLI Commands

```bash
connect-voygr signup --email <email> [--name <name>]
connect-voygr recover --email <email>
connect-voygr check-business-status --name <name> --address <address>
connect-voygr get-usage
connect-voygr config set-key <key>
connect-voygr config set-base-url <url>
connect-voygr profile list|use|create|delete|show
```
