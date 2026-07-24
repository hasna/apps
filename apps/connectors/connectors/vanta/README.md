# @hasna/connect-vanta

Vanta Manage API connector for automating compliance controls, documents, and event logs in your Vanta tenant.

## Authentication

Uses OAuth 2.0 `client_credentials` against `POST https://api.vanta.com/oauth/token` with a JSON body. API requests use a **Bearer token** in the `Authorization` header.

Create a Manage Vanta application in the [Vanta Developer Console](https://developer.vanta.com/), then configure credentials:

```bash
connect-vanta config set-credentials <client_id> <client_secret>
```

Or set environment variables (see `.env.example`).

## Install

```bash
bun install
bun run build
```

## CLI

```bash
# List controls
connect-vanta controls list --framework soc2

# Get a control
connect-vanta controls get <controlId>

# Create a control (requires write scope)
connect-vanta controls create -n "My control" -d "Description"

# List event logs
connect-vanta events list --start-date 2026-01-01T00:00:00Z

# Search documents (filters via GET /documents — no global search endpoint)
connect-vanta documents search --framework soc2 --status needs_attention

# Raw authenticated request
connect-vanta raw request /controls -X GET
```

## API

```typescript
import { Vanta } from '@hasna/connect-vanta';

const vanta = Vanta.fromEnv();
const controls = await vanta.controls.list({ pageSize: 10 });
```

## Vanta Gov

FedRAMP customers should set `VANTA_BASE_URL=https://api.vanta-gov.com/v1`.

## Docs

- [Manage Vanta API](https://developer.vanta.com/reference/manage-vanta/overview)
- [Authentication](https://developer.vanta.com/docs/concepts/authentication)
