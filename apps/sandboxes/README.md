# `@hasnaxyz/sandboxes`

Self-hosted, tenant-scoped disposable **sandbox provisioning** for the Hasna fleet
(Daytona / E2B). Private internal app. Four surfaces, one shared cloud service:

| Surface | Entry | What it is |
|---|---|---|
| **API** | `sandboxes-serve` (`dist/http/server.js`) | HTTP `/v1` + public `/health`, API-key auth, tenant-scoped, Postgres control plane + tenant-prefixed S3 blobs. |
| **CLI** | `sandboxes` | Thin `/v1` API client (no local DB). |
| **SDK** | default export of the package | Typed `fetch` client, `import SandboxesClient from "@hasnaxyz/sandboxes"`. |
| **MCP** | `sandboxes-mcp` (`./mcp`) | stdio MCP server, every tool proxies `/v1`. |

All clients talk to `https://sandboxes.hasna.xyz/v1` with an API key — never a
database DSN, never a provider credential (those live server-side only).

## Configuration

Clients:

- `HASNA_SANDBOXES_API_URL` — base URL (with or without a trailing `/v1`).
- `HASNA_SANDBOXES_API_KEY` — bearer key.

Server (`sandboxes-serve`):

- `HASNA_SANDBOXES_DATABASE_URL` — Postgres (control plane). Absent ⇒ in-memory (local/test).
- `HASNA_SANDBOXES_API_KEY` — static bootstrap admin key (maps to the root tenant).
- `HASNA_IDENTITIES_JWKS_URL` — enables v2 identities-JWS verification (dormant until identities v2 is live).
- `HASNA_SANDBOXES_S3_BUCKET` — checkpoint blob bucket (keys are `sandboxes/<tenant_id>/…`).
- `PORT` (default 8080), `HOST` (default 0.0.0.0).

## Tenancy (fail-closed)

Every `/v1` request is bound to a `(tenant_id, user_id, scopes)` derived **server-side**
from the verified credential — never from the request body. Missing/unresolvable tenant ⇒
`403`. Cross-tenant ids ⇒ `404` (existence is not leaked). The fixed fleet root tenant is
`adfd95c7-ee8b-52cb-ae47-4ae65dae3313` (slug `hasna`). Auth resolves via (1) the static
bootstrap key, (2) an identities-signed v2 JWS (JWKS), or (3) a minted API key whose SHA-256
hash resolves a `sandboxes.api_keys` row carrying the tenant (the kid→tenant bridge).

Schema: `sandboxes.{tenants,users,memberships,tenant_provider_quota,tenant_provider_credentials,api_keys,allocations,checkpoints}`
(`migrations/self-hosted/0001_control_plane_tenancy.sql`, applied by `sandboxes-serve migrate`).

## `/v1` endpoints

```
GET  /health                              (public)          GET  /version                 (public)
GET  /v1/health   GET /v1/whoami          POST /v1/validate/:kind      GET /v1/adapters
POST /v1/sandboxes  (allocate)            GET  /v1/sandboxes           GET /v1/sandboxes/:id
POST /v1/sandboxes/:id/destroy            POST /v1/sandboxes/:id/checkpoints
GET  /v1/sandboxes/:id/checkpoints        GET  /v1/checkpoints/:id
POST /v1/admin/tenants  POST /v1/admin/quota  POST /v1/admin/api-keys  POST /v1/admin/api-keys/:kid/revoke
```

## Provider allocation is gated (R1)

Live provider dispatch (Daytona/E2B) is **not** enabled in R1 — the STOP boundary. The
`fake` adapter drives the allocation record lifecycle for tests/dev; real adapters record a
`requested` allocation but are never dispatched (fail-closed, never faked). The cryptographic
effect-journal domain (`src/service.ts`, `src/adapters/managed/*`) is the server-internal
substrate the R2 live path wires into. It is not part of the client SDK surface.

## Develop

```
bun install
bun test            # domain + http/auth/tenancy + sdk/mcp
bun run typecheck
bun run build
bun run serve       # in-memory unless HASNA_SANDBOXES_DATABASE_URL is set
```
