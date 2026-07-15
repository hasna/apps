# Architecture

Computers separates controller mode from provider kind. The included local controller uses SQLite; a future self-hosted controller uses the PostgreSQL schema and RLS policy. Provider ports are `local_machine`, `local_vm`, and `aws_ec2`.

Every public mutation enters `ComputersService`, passes `AuthorizationEngine`, and then uses `StoragePort`. The authorization decision combines tenant, principal, scope, bound Computer, owner, and policy generation. REST, SDK, CLI, and MCP do not implement independent policy shortcuts.

SQLite enables foreign keys, WAL, full synchronous writes, a busy timeout, parameterized queries, immediate transactions for allocation/idempotency, unique active owner assignment, durable controller-owned creation grants, atomic child quota reservation, one-time enrollment, replay nonces, one-writer home leases, immutable policy revisions, single-use tickets, append-only audit, and outbox records. Every tenant-scoped lookup includes `tenant_id`.

Creation limits live only in `computer_create_grants`; child requests reference a grant but cannot choose a limit. The transaction validates grant tenant, parent, principal/owner, provider, active state, expiry, and current reservation count before inserting the Computer and reservation. Duplicate and distinct requests share the same immediate transaction and uniqueness constraints.

Persistent SQLite controllers generate the install-ticket HMAC key once in protected controller storage and force the database file to mode `0600`. In-memory or non-persistent storage must supply an explicit signing-key provider. Policy revision advancement atomically increments fences on older pending/running operations, and both the worker and resident reject an operation whose stored generation no longer matches the Computer.

PostgreSQL defines the same core resource families and stronger structural constraints, but runtime parity is deliberately not claimed. The package has no PostgreSQL adapter or live-server integration. Its migration forces RLS, treats a missing `computers.tenant_id` setting as no tenant, revokes public access, and requires a non-owner `NOBYPASSRLS` application role distinct from the migrator. See [the PostgreSQL contract](postgresql.md).

Durable operations are accepted before provider execution. The worker persists a provider attempt, provider idempotency key, resource identity, typed outcome, and provider binding. `unknown` outcomes hold child quota and are sent to the adapter's reconciliation method until the resource is adopted or definitely absent/cleaned. The included adapters are unconfigured, so real provider execution still fails truthfully with `provider_not_configured`.
