# Canonical-client migration: review candidate

This owner-directed breaking removal of local client storage is not a release.
PRs 561 and 565 were inspected against verified main base
5d2fcfb02cc7a06d3f36c40b9c51141e1bc993dc. Both retain absent-config SQLite fallback;
561 also uses the stale client placement contract. Their placement model is not adopted.

## Architecture and dependency provenance

All public client entries require authenticated explicit HTTPS configuration.
The package root exports the remote Store; ./sdk exports the generated /v1 JSON
client. LocalStore, local storage primitives, local createApp/startServer and the
legacy /api AttachmentsClient are no longer public exports. Removed operations
fail explicitly rather than selecting another dataset.

Key and configuration validation runs before every authenticated dispatch. Same
authority key rotation is supported; changed authority requires a new client.
Redirects and body retries are disabled, including binary download. Remote errors
do not echo arbitrary response bodies. Todos/Sessions integrations follow their
own explicit HTTPS authority and key configuration.

The server requires explicit validated PostgreSQL configuration and S3 object
storage. The old generated mode selector was removed. src/server-storage contains
application-owned adapters derived from the existing 0.8.2 kit, with provenance
in its README; it is not falsely labeled an unmodified generated kit.
No unpublished Contracts source was copied or consumed.

Contracts remains at ^0.8.2 (the standalone committed lock resolves 0.8.7);
the artifact scanner remains pinned to published 0.8.2. Reviewed security commit
7ab022d87b48fd15f0ce1831fc560e0651b8c232 and test-only successor
2b15c73f949729a001d5dc88509650f61e58ee41 were used only as read-only conformance
evidence. Their canonical credential/server kit changes are unpublished.
The static credential-seam check passing is NOT proof of actual shared-seam adoption:
this application currently enforces the boundary in application-owned code.
Adopting the released canonical shared implementation remains a release blocker.

Configuration uses @hasna/paths; agent attribution uses its state directory.
Explicit input files and download destinations are not an application dataset.
Legacy directories remain untouched; no migration/copy/cleanup code was introduced.

## Verification on Bun 1.3.14

- Full verify:release passes: typecheck, 65 isolated checks, build/declarations and
  packed-artifact scan (93 members, zero unreadable). Live PG cases are skipped,
  not represented as successful integration.
- Generated SDK build passes; both generated source copies match.
- Fifty lifecycle tests include forty-five real HTTP redirect cases across upload,
  download and SDK writes: 301/302/303/307/308 to same HTTPS, cross HTTPS and HTTP.
  No destination receives credentials or a replayed body.
- Legacy command/MCP behavior remains covered through an explicit test-only
  in-memory fixture. Unmocked security tests enforce the actual production boundary.
  Legacy-data sentinel tests prove import/config failure neither copies nor modifies it.
- Root filtered frozen install and isolated standalone frozen install pass.
  Lock changes are scoped to replacing the inherited Events client dependency
  with @hasna/paths 0.2.2; other resolutions are preserved.
- Exact local reviewed-validator repo-conformance passes (health shape skipped
  without a live sample). The currently published validator remains incompatible
  with the PostgreSQL-only manifest; the CI conformance gate is not waived.
- Root conformance reporting tests pass 10/10 while reporting existing violations,
  including the old validator incompatibility. Restricted PATH confirms todos and
  hasna are absent: automatic reconcile tasks were NOT FILED.
- Requiring live PostgreSQL with no disposable DSN correctly fails. No live
  PostgreSQL, cloud credentials, deployed service or production data were accessed.

## Release blockers

Independent-review follow-up fixes the pg DSN parser TLS override and makes
migration plan/apply/record atomic under a dedicated transaction and advisory lock.
Thirty additional server-storage regression tests cover actual pg.Client options,
ambiguous TLS parameters, rollback, connection disposal, concurrency, drift and
transaction-control rejection. pg 8.22.0 and 8.23.0 Client construction were checked
without connecting; live PostgreSQL remains unverified.

An independent review of the exact implementation commit, released canonical
Contracts adoption and revalidation against that published artifact, separately
authorized live PostgreSQL verification, and the normal version/provenance release
audit remain required. Versions have not been bumped; nothing was pushed,
published, deployed or migrated. The earlier failing checkpoint test counts are
superseded by this completed local verification, not used as release evidence.
