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
command was not run against any live database. Tests use an in-memory PostgreSQL
engine only. Existing SQLite data and compatibility code were not deleted or
copied.

## Explicit remaining gaps

This is **not whole-package migration completion** and is not publishable as such.

- Root library exports retain synchronous legacy service/database access.
- HTTP MCP retains its legacy signed-token authentication/store. The stdio domain
  follow-up below migrates only the 43 domain tools, not the whole MCP graph.
- MCP agent registration, heartbeat and focus remain process-local.
- MCP feedback still acknowledges without a delivery backend.
- MCP storage push/pull/sync remain audited no-op legacy implementations.
- The stdio follow-up removes the inline postinstall directory-creation hook;
  legacy runtime XDG-adoption behavior remains unchanged.
- The existing live PostgreSQL gate exercises the old generic cloud probe, not
  this new domain path; live domain proof remains outstanding and unrun.

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

Native conformance remains intentionally blocked by the pinned published
`@hasna/contracts@0.14.2`: it rejects a PostgreSQL-only service unless a local
SQLite/JSON engine is declared. The two native conformance assertions fail for
that reason; the functional tests pass. The exact reviewed but **unpublished**
Contracts commit `2b15c73f949729a001d5dc88509650f61e58ee41` validates the accurate
PG-only manifest. No false local-engine declaration, invented version, or
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

## Stdio domain follow-up — still NO_GO for the full package

- Owner: `/root/access_stdio_domain_migration`; registered commit trailer `fixer`.
- Verified PR #1494 head/base for this delta:
  `1d6534e92961e5f3e38056842e58e1142ed90498` (PR target remains `main`).
- Branch: `codex/fixer/2026-09-02-access-stdio-domain`.
- Worktree: `/Users/hasna/Workspace/50-repositories/_worktrees/hasna/apps/access-stdio-domain`.
- Canonical reference and existing Access implementation/review worktrees were
  not edited. No overlapping open Access PR or branch/path collision was found.

Stdio now constructs a validated, snapshotted `AccessClient` before connecting,
and injects it into all 43 domain callbacks. Dispatch is awaited. The nine tool
definition files keep their schemas, names and operation mappings. Profiles
remain 18/37/51 total tools (10/29/43 domain tools plus eight always-on tools).
Write confirmation is required and its MCP-only fields are stripped before HTTPS.
There is no fallback to the local registry when the stdio client fails.

HTTP MCP continues calling `buildServer(context)`, which does not create or
receive a process-owner HTTPS executor. No opaque or Access-issued HTTP caller
token is forwarded to the API, and no generic introspection contract was inferred
from `token.verify`. The caller-context HTTP transport/authentication source is
unchanged. An isolated HTTP test uses an authenticated `auditor` fixture and proves
a denied write triggers zero process-key HTTPS requests. This is separation proof,
**not** acceptance of the legacy HTTP authorization implementation.

The new non-2xx adapter accepts only source-defined error codes with matching HTTP
statuses, a string message and an optional string suggestion (the core's gate
errors omit suggestion). It replaces all remote text with fixed local diagnostics,
preserves the HTTP status in the message and the domain code in MCP envelopes,
bounds parsing to 16 KiB and one second, cancels the body reader and clears the
deadline on every path. Malformed, oversized, stalled and unknown envelopes yield
the existing generic HTTP-status error; they never echo raw response data.

Only the actual inline package.json postinstall hook was removed. The obsolete
unreferenced `scripts/postinstall.ts` and existing user data were not removed.
`scripts/check-install-state.ts` packs with prepack disabled (the known native
conformance blocker remains), then performs a real npm consumer install with
lifecycle scripts enabled and empty npmrc files. It checks all three bins, root
and SDK artifacts, SDK imports, and fail-closed stdio startup in a fresh HOME/XDG
and an explicit temporary legacy DB guard. Bun's own transpiler cache is directed
to a separate test-owned location. This check is not release approval.

Remaining acceptance gaps include the root compatibility surface (extra metadata,
null clearing and status setters), HTTP MCP caller authentication, standard
agent/focus/feedback APIs, authenticated storage status/admin migration APIs, the
new core live-PostgreSQL gate and published shared Contracts adoption. The eight
standard/storage tools remain intact and local/legacy: the MCP bundle still
contains the legacy SQLite graph. Storage status can open a local store;
push/pull/sync remain audited no-op implementations. Whole-MCP HTTP-only claims
would therefore be false.

Legacy auth also normalizes an empty opaque-credential role list to `integration`
(read/write); explicit read-only scopes are additive and do not cap that role.
This is an explicit unchanged HTTP/root security blocker. During an initial
unisolated test, that behavior created a fixture in the default legacy database;
the incident was reported to the coordinator, the database/sidecars were preserved,
and all later runs were moved to fresh task-owned HOME/XDG and database overrides
before imports. The detailed local incident record is outside the package.

Verification evidence and native gate outcomes for this follow-up are retained
under `/tmp/access-stdio-verification.8uOpGi`:

- Native full suite: **202 pass, 2 fail** across 204 tests. Both failures are the
  unchanged old Contracts validator rejecting the accurate PostgreSQL-only
  manifest. Merged Contracts source is not a published version; pins are unchanged.
- All 43 HTTPS-to-PostgreSQL-engine operations pass. Stdio tool mapping, schemas,
  async results/errors, optional metadata/arrays/versions, profile totals,
  confirmation/no-dispatch and HTTP separation checks pass.
- Never-ending and slow error-body regressions failed before the deadline fix;
  both now fall back and cancel in approximately one second.
- Package typecheck/build pass. The isolated real npm install and all entrypoint
  checks pass with lifecycle scripts enabled and zero implicit home/XDG/DB state.
- Packed artifact: 203 scanned entries, no findings, skips or unreadables.
- Root names/dependency-direction/manifest gates pass. The broader root `check`
  was stopped at publish-guard after discovering other packages' prepack/build
  lifecycles. Access's native prepack failed its known conformance tests;
  unrelated failures include attachments' `mapfile` and connectors'
  missing `vite`. It is **incomplete**, not passing. No unrelated tracked changes
  resulted. Later root checks in that chain were not run.
- No live PostgreSQL service, cloud deployment, whole-package acceptance or
  publication was performed. No native prepack/release gate passed.

No merge, deployment, migration,
credential change or npm publication is authorized for this worker. The exact
committed delta must receive independent review before any coordinated push.
