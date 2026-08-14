# CLAUDE.md

Guidance for working with the `@hasna/connect-usps` connector.

## Overview

TypeScript CLI and library for the USPS shipping REST API. Authentication uses a **Bearer token** (`USPS_API_KEY`). Default base URL is `https://api.usps.com/v1`.

Official documentation: https://developers.usps.com/

## Commands

```bash
bun install
bun run dev
bun run typecheck
bun test
bun run build
```

## CLI

```bash
bun run dev shipments list
bun run dev shipments get <shipmentId>
bun run dev shipments create --body '{"..."}'
bun run dev events list
bun run dev search --body '{"query":"..."}'
bun run dev raw --path /shipments
bun run dev config set-key <key>
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `USPS_API_KEY` | Bearer API key (required) |
| `USPS_BASE_URL` | Optional API base URL override |

## Auth

Bearer token in `Authorization: Bearer <USPS_API_KEY>` header. Dashboard auth detection reads this file for bearer auth type.

## Project Structure

```
src/
├── api/
│   ├── client.ts      # HTTP client
│   ├── client.test.ts # Unit tests
│   └── index.ts       # Usps API class
├── cli/index.ts       # Commander CLI
├── types/index.ts     # Types and errors
└── utils/             # Config, output, auth helpers
```

## Data Storage

Profiles stored at `~/.hasna/connectors/usps/profiles/`.
