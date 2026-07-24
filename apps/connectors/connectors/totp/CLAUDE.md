# CLAUDE.md

Guidance for working on the Totp connector (`@hasna/connect-totp`).

## Overview

Bearer-authenticated REST client for the Totp API at `https://api.totp.com/v1`.

## Auth

- **Type:** API key (Bearer token)
- **Env:** `TOTP_API_KEY`, optional `TOTP_BASE_URL`
- **Profile storage:** `~/.hasna/connectors/connect-totp/profiles/`

## API surface

| Method | Endpoint | SDK method |
|--------|----------|------------|
| GET | `/codes` | `listCodes()` |
| POST | `/codes` | `createCode(body)` |
| GET | `/codes/:codeId` | `getCode(codeId)` |
| GET | `/events` | `listEvents()` |
| POST | `/search` | `search(body)` |
| * | arbitrary | `rawRequest(options)` |

## Commands

```bash
bun install
bun run dev
bun run typecheck
bun run build
bun test src/api/client.test.ts
```

## CLI

Binary name: `connect-totp`

Subcommands: `profile`, `config`, `codes`, `events`, `search`, `raw-request`

## Registry

Listed in `src/lib/connectors/security-compliance.ts` as `totp` under **Security & Compliance**.
