# CLAUDE.md

Guidance for working with the Vanta Manage API connector.

## Overview

`connect-vanta` wraps the [Vanta Manage API](https://developer.vanta.com/reference/manage-vanta/overview) for automating controls, documents, and event logs in your own Vanta tenant.

**Authentication:** OAuth 2.0 `client_credentials` → **Bearer token** on all `/v1/*` requests.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Auth

1. Create a Manage Vanta app in the Developer Console.
2. Exchange `client_id` + `client_secret` at `POST https://api.vanta.com/oauth/token` (JSON body, not form-encoded).
3. Send `Authorization: Bearer <access_token>` on API calls.
4. Tokens expire after 1 hour; the client caches and refreshes automatically (60s buffer).
5. Rate limit: 5 token requests/minute — token minting is centralized in `VantaClient`.

Profiles stored at `~/.hasna/connectors/connect-vanta/profiles/`.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VANTA_CLIENT_ID` | OAuth client ID |
| `VANTA_CLIENT_SECRET` | OAuth client secret |
| `VANTA_SCOPE` | Default `vanta-api.all:read` |
| `VANTA_BASE_URL` | Default `https://api.vanta.com/v1` |

## API Mapping

| Command | Endpoint |
|---------|----------|
| `controls list` | `GET /controls` |
| `controls create` | `POST /controls` |
| `controls get` | `GET /controls/{id}` |
| `events list` | `GET /event-logs` |
| `documents search` | `GET /documents` (no global `/search`) |
| `raw request` | Arbitrary authenticated path |

## Vanta Gov

Use `VANTA_BASE_URL=https://api.vanta-gov.com/v1` for FedRAMP tenants.
