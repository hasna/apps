# Multi-tenancy backend

The OSS core of PersonalNotes ships a headless multi-tenancy backend: registration
and login, sessions and API tokens, per-tenant isolation, and a single global
super-admin plane. The desktop app (in `platform-personalnotes`) and the CLI
authenticate against this backend over HTTP.

## Deployment modes

Runtime placement is resolved from the environment (hasna-deployment-doctrine):

- **local** — SQLite authoritative at `~/.hasna/personalnotes/personalnotes.db` (default).
- **self_hosted** — a server you operate; `personalnotes-serve` holds
  `HASNA_PERSONALNOTES_DATABASE_URL` (PostgreSQL). Clients flip to HTTP.
- **cloud** — the Hasna-operated SaaS (`platform-personalnotes`), out of scope for the core.

Env prefix is `HASNA_PERSONALNOTES_` with the legacy `PERSONALNOTES_` alias accepted.

| Variable | Purpose |
| --- | --- |
| `HASNA_PERSONALNOTES_DATABASE_URL` | PostgreSQL DSN (server-side only). Present ⇒ Postgres engine. |
| `HASNA_PERSONALNOTES_SQLITE_PATH` | SQLite file path (default `~/.hasna/personalnotes/personalnotes.db`). |
| `HASNA_PERSONALNOTES_SUPER_ADMIN_EMAIL` | Super admin email (default `andrei@hasna.com`). |
| `HASNA_PERSONALNOTES_SESSION_TTL_SECONDS` | Session token lifetime (default 30 days). |
| `PERSONALNOTES_TEST_DATABASE_URL` | Disposable Postgres DSN for the live-PG test gate. |

## Run the API

```bash
bun run dev:serve            # or: personalnotes-serve   (PORT defaults to 3366)
curl -s localhost:3366/health
```

## HTTP surface

Public probes: `GET /health`, `GET /ready` (fails 503 on pending migrations),
`GET /version`.

Auth control plane (`/v1`):

| Method & path | Auth | Description |
| --- | --- | --- |
| `POST /v1/auth/register` | none | Create a tenant + first (owner) user; returns a session token. |
| `POST /v1/auth/login` | none | Email/password login; returns a session token. |
| `POST /v1/auth/logout` | bearer | Revoke the presented token. |
| `GET /v1/auth/me` | bearer | Current principal (tenant, user, role, super-admin). |
| `POST /v1/auth/tokens` | bearer | Mint a long-lived API token for the caller (CLI/agent). |
| `GET /v1/auth/tokens` | bearer | List the caller's live tokens (metadata only). |
| `GET /v1/tenant/users` | bearer | Users in the caller's tenant (owner/admin, or super admin cross-tenant via `?tenantId=`). |
| `GET /v1/admin/tenants` | bearer (super admin) | Every tenant. |
| `GET /v1/admin/users` | bearer (super admin) | Every user across tenants. |

Tokens are opaque bearer strings (`pn_sess_*` sessions, `pn_*` API keys). Only their
sha256 is stored; the plaintext is returned exactly once.

## SDK

```ts
import { PersonalNotesAuthClient } from "@hasna/personalnotes/sdk";

const client = new PersonalNotesAuthClient({ baseUrl: "http://localhost:3366" });
await client.register({ email: "you@example.com", password: "correct horse battery" });
const me = await client.me();
```

## Isolation model

- Email is globally unique and identifies a user; each user belongs to exactly one tenant.
- Tenant-scoped storage methods take an explicit `tenantId` and return `null` /
  no-op for ids owned by another tenant — a session for tenant A can never read or
  mutate tenant B's rows.
- On PostgreSQL the same interface is enforced; the platform control plane layers
  Postgres RLS on top (hasna-saas-playbook-standard).
- The super admin (`andrei@hasna.com`) is the only principal permitted to cross the
  tenant boundary, through the dedicated `/v1/admin/*` plane.
