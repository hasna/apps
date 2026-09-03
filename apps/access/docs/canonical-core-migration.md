# Access canonical core migration — partial lane

## Ownership and source

- Owner: `/root/access_canonical_impl`; registered commit trailer: `fixer`.
- Base: fetched `origin/main`, `5d2fcfb02cc7a06d3f36c40b9c51141e1bc993dc`.
- Branch: `codex/impl/2026-09-02-access-canonical-client`.
- Worktree: `/Users/hasna/Workspace/50-repositories/_worktrees/hasna/apps/access-canonical-client`.
- Canonical checkout remained clean. Requested path/branch were unused before creation.
- Relevant Access PRs: XDG #1318, serve help #712, contract alignment #475 were merged;
  no open Access-title PR overlapped this core migration.
- Source comparison established 43 domain operations and 43 matching REST routes,
  with no missing or extra route operations.

## Implemented boundary

The CLI and `./sdk` snapshot one explicit HTTPS authority with its credential,
reject missing/blank/conflicting inputs and placement/database selectors, and
refuse redirects. No core client writes local config, cache, state, or app data.
Production CLI/SDK/serve bundle tests prove those dependency graphs exclude
`bun:sqlite` and the legacy `openDatabase` implementation.

The default serve entry uses asynchronous PostgreSQL domain functions extracted
from existing rules. All 43 operations retain their routes, scopes, data shapes,
and service-layer entity checks. Each request runs within one dedicated database
transaction. A shared PostgreSQL advisory lock serializes read-modify-write and
audit-chain updates. Failure rolls back the entire operation; audit UPDATE/DELETE
is rejected by a PostgreSQL trigger. No client DSN is consumed and there is no
SQLite fallback.

Server startup validates authentication, signing posture and PostgreSQL/schema
availability before binding. Schema changes require explicit `--migrate`; that
command was not run against any live database. Tests default to an in-memory
PostgreSQL engine, with an explicit live option: setting
`ACCESS_TEST_DATABASE_URL` (the same test-only variable the live gate uses) runs
the identical 43-operation domain path against a real PostgreSQL server through
the production pool constructor, which itself enforces `sslmode=verify-full` and
`PGSSLROOTCERT`. The live domain proof below used that option. Existing SQLite
data and compatibility code were not deleted or copied.

## Explicit remaining gaps

This is **not whole-package migration completion** and is not publishable as such.

- Root library exports retain synchronous legacy service/database access.
- MCP remains unchanged, including its legacy signed-token authentication/store.
- MCP agent registration, heartbeat and focus remain process-local.
- MCP feedback still acknowledges without a delivery backend.
- MCP storage push/pull/sync remain audited no-op legacy implementations.
- Postinstall and legacy XDG-adoption behavior are unchanged.
- **Resolved: live PostgreSQL domain proof** (2026-09-03). The 43-operation
  core-domain path — `migrateCoreSchema`, per-operation transactions with the
  `pg_advisory_xact_lock(1935762275)` serialization, the audit append-only
  trigger, whole-operation rollback, and every HTTPS-to-PostgreSQL operation —
  ran green against real PostgreSQL 16.15 over TLS with `sslmode=verify-full`
  and a CA-verifiable server certificate (self-signed test CA via
  `PGSSLROOTCERT`, SAN `localhost` + `127.0.0.1`). The proof used the app's own
  production pool constructor (`createCorePool`) — the same validation and
  connection path `access-serve` uses — driven by the test-only
  `ACCESS_TEST_DATABASE_URL` variable, so the domain test remains hermetic
  (in-memory engine) unless a DSN is explicitly pointed at a throwaway store.
  1 pass / 0 fail (14 expect() calls, ~190 ms), plus the legacy cloud gate
  (`test:postgres`) passing against the same server. Container was destroyed
  after evidence capture. The `live-postgresql-domain-proof` remaining surface
  in `hasna.contract.json` was removed; the legacy gate lives on unchanged.

An HTTP MCP proxy cannot safely substitute process-owner credentials for a caller.
No remote identity-introspection or feedback protocol was invented, and no
capability was silently withdrawn. Those boundaries need their own approved work.

## Verification and dependency limitation

Pinned Bun: `1.3.14`; system Bun was not replaced.

- Functional coverage includes all 43 HTTPS-to-PostgreSQL operations, signed-token
  read/write scope enforcement and revocation, unscoped/missing authentication,
  audit-trigger immutability, whole-operation rollback after an audit-write error,
  and client/CLI configuration, redaction and redirect refusal.
- Full suite with test-only substitution of the exact reviewed Contracts source:
  **151 pass, 0 fail**. This substitution does not change package dependencies.
- Typecheck and all package build surfaces pass.
- Root and standalone frozen-lockfile installs pass with scripts disabled.
- Local npm pack uses `--ignore-scripts`; the packed artifact passes the exact
  reviewed Contracts artifact scanner with no findings, skips, or unreadables.
- Root name and dependency-direction gates pass.
- The initial root standard run caught the now-stale Access SDK exception; that
  one entry was removed, and the targeted four-surface suite passes.
- Root publish-guard finds no internal-infrastructure strings in Access. Other
  packages have unrelated missing-declaration/build failures; those were not fixed.
- Staged secret scanner and its positive/negative self-tests pass.

Pinned published `@hasna/contracts@0.14.2` requires a service to declare
postgresql alongside a local SQLite/JSON engine, so the manifest keeps the
sqlite engine entry while the retained legacy surfaces (root library, MCP,
compatibility code) genuinely still reach SQLite. A PG-only manifest validates
only against the exact reviewed but **unpublished** Contracts commit
`2b15c73f949729a001d5dc88509650f61e58ee41`; no invented version or
unpublished dependency adoption was introduced.

Verification logs are retained under `/tmp/access-canonical-verification.1xiD2z`.
Root standard gates used a restricted PATH with `Bun.which("todos") === null`;
automatic task filing reports **NOT FILED**. No credentials, live database,
cloud resources, pushes, PR writes, deployment, merge or publication were used.
Independent exact-commit review is the next gate.

## Core security re-review fixes

The independent review of `05e9f308ebe94f373b898eca6056868c6be74752` identified
three P1s. The follow-up keeps changes confined to the canonical core:

- Expiry sweeps constrain both SELECT and UPDATE to the caller's entity set;
  an empty allowed set cannot change rows or append expiry audit events.
- Token issuance requires an active identity. Every issued-bearer verification
  rechecks current identity status, so suspension/retirement invalidates use.
- Every explicit signing-key and key-file declaration must validate and agree.
  Missing/unreadable/blank pointers cannot fall through to inline credentials.
  Each server captures its signer before asynchronous startup, with request-local
  binding across issuance/authentication. File/env changes require an explicit
  server restart to adopt new signing authority; they cannot retarget an in-flight
  request or silently switch a running server's signer.

Five adversarial tests reproduced the findings before implementation; after the
fix they pass alongside all 43 PostgreSQL-engine operations. Additional tests
check overlapping signing contexts, equivalent aliases, weak/development keys,
and invalid key files. The historical extraction script must not overwrite these
independently reviewed divergences with legacy service behavior.

P1 verification: **158 pass, 0 fail** using the exact reviewed Contracts source
as a test-only substitution; native published-validator run is **156 pass,
2 conformance failures**, unchanged in cause. Typecheck/build and frozen root and
standalone installs pass. The rebuilt package contains 201 scanned entries with
zero artifact findings/skips/unreadables. Root standards/publish-guard are rerun
with the same restricted PATH and no task filing; their published-validator and
unrelated declaration blockers remain separate from the repaired core behavior.
