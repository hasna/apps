# Changelog

All notable changes to `@hasna/personalnotes` are documented here.

## [Unreleased]

### Added — multi-tenancy backend

- **Auth service** (`AuthService`): email/password registration and login, session
  tokens and long-lived API tokens (`pn_sess_*` / `pn_*`, sha256-hashed at rest),
  token verification, and logout (revocation).
- **Per-tenant isolation**: registration provisions a tenant with its first user as
  `owner`; all tenant-scoped storage reads/writes require an explicit `tenantId` and
  never cross the tenant boundary. Cross-tenant access is available only to the
  super-admin plane.
- **Super administrator**: `andrei@hasna.com` (configurable via
  `HASNA_PERSONALNOTES_SUPER_ADMIN_EMAIL`) is granted `isSuperAdmin` on registration
  and can list/suspend tenants and list users across all tenants.
- **Dual storage** (hasna-storage-standard): backend-tagged `AuthStorage` contract
  with SQLite (`bun:sqlite`, default, authoritative locally) and PostgreSQL adapters,
  ledgered + checksum-verified migrations, and an env-gated live-PG test suite
  (`PERSONALNOTES_TEST_DATABASE_URL`). The hermetic `bun test` suite needs no Postgres.
- **HTTP API** (`personalnotes-serve`, `Bun.serve` hand-rolled router): `GET /health`,
  `/ready` (migration dry-run), `/version`, and `/v1/auth/*` + `/v1/admin/*` control
  plane. API is the primary surface.
- **Auth SDK client** (`@hasna/personalnotes/sdk`): the token-holding HTTP client the
  desktop app and CLI use to authenticate against a running backend.

Notes: this workstream adds the headless auth/tenancy backend only; the existing
SwiftUI/web UI is preserved untouched.
