# Calendar domain migration — partial, not release-ready

## Ownership and authority

- Owner: calendar_canonical_impl; registered commit trailer: fixer.
- Base: origin/main `5d2fcfb02cc7a06d3f36c40b9c51141e1bc993dc`, fetched before creation.
- Branch: `codex/impl/2026-09-02-calendar-canonical-client`.
- Worktree: `/Users/hasna/Workspace/50-repositories/_worktrees/hasna/apps/calendar-canonical-client`.
- Canonical checkout was clean and remains a read-only reference.
- Open PR #459 is manifest/artifact-gate work, not the domain client migration;
  its older local-engine architecture is not the target.
- Root authorized this scoped implementation after discovery of the Events API
  gap. No publication, remote write, deployment, credential or data migration
  authority is implied.

## Implemented boundary

CalendarStore operations use one authenticated explicit HTTPS API/key pair.
The canonical and alias environment values must be nonblank and agree. Retired
placement selectors fail closed. Store objects do not rebind, credentials are
captured privately, header overrides and redirects are rejected, and only reads
retry (server write deduplication is not established).

All 33 generated SDK operations retain their existing routes and response
envelopes and delegate to the same transport. The root no longer exposes
LocalStore. No domain command falls back after network or authentication failure.
Malformed store envelopes are errors rather than empty/successful results.

The server validates an app-scoped PostgreSQL DSN before binding, with no SQLite
default. Connections remain lazy; explicit schema migration code is unchanged.
An enabled server MCP plane must also validate its HTTPS client configuration.
Readiness errors do not return driver messages to callers.

## Deliberately unresolved public capabilities

- `registerEventsCommands` in the CLI still provides Events/channel/delivery
  operations through `@hasna/events` local JSON storage. These are not Calendar
  scheduling events, and no corresponding remote service contract was found.
- Explicit `db-migrate` and the legacy database implementation are unchanged.
  This is not a remote import. Legacy paths/data are preserved, not normalized,
  deleted or silently promoted to remote authority.
- No new runtime filesystem paths were introduced. Existing installation and
  legacy integration paths remain part of the unresolved package-wide work.
- Shared canonical Contracts commit `2b15c73f949729a001d5dc88509650f61e58ee41`
  remains unpublished. The package retains its released dependency. The local
  HTTPS seam cannot yet claim shared released credential-seam compliance.
- Artifact lifecycle wiring remains the separately inventoried open #459 work.
  Direct scans here do not imply that release/prepack gates are complete.

## Original implementation verification (1cce817)

Runtime: Bun 1.3.14, initially via `npx -y bun@1.3.14`, then a temporary
PATH-only symlink to that exact binary. System Bun was not replaced.

- Regression-first: three new safety tests failed against the old resolver,
  cache and mutable credential transport, then passed after implementation.
- Full Calendar suite: 231 pass, 12 skipped live-PostgreSQL tests, 3 failures
  in unchanged legacy database-path tests. All three reproduce on the canonical
  base: legacy-home discovery and `/var` versus `/private/var` receipt/scan paths.
- Additional latest domain/SDK suite: 7 pass, 0 fail, 70 assertions; exercises
  all 33 generated operations through real `/v1` handlers, retry authority,
  no automatic write retry and malformed envelopes. Fixtures inject fetch
  explicitly and use SQLite only as the test server. Production code does not
  import the fixtures. CLI output/pagination and MCP behavior coverage retained.
- Build, typecheck, scoped Turbo build (`--filter=@hasna/calendar --only`) and
  frozen install with scripts disabled passed. Generated SDK regeneration ran.
- Release/bin suite passes, including npm pack dry-run, executable bits and
  assertions that root, SDK, MCP and server bundles have no SQLite/LocalStore
  or test fixture implementation.
- Root name and dependency-direction checks: 74 members, 0 violations.
- Root manifests: 54/74 conform, 20 recorded exceptions, 0 refusals. Released
  Contracts rejects the PostgreSQL-only manifest under its old local-engine
  rule. Exact reviewed unpublished Contracts validates it successfully.
- Canonical repo-conformance still reports missing artifact lifecycle wiring
  and the local credential seam, both explicit unresolved release blockers.
- Root standard: 71 pass, 1 registry-backed 5-second timeout. The failing
  connector-quarantine file passed on pinned retry: 7 pass, 0 fail. Restricted
  PATH made Todos unavailable; output explicitly reports NOT FILED.
- Root publish guard reached Calendar: 74 tarball entries, 74 contents scanned,
  0 internal-infrastructure strings. Aggregate guard was stopped (143) after
  unrelated Attachments bash/mapfile and Contracts baseline prepack failures;
  no aggregate-green claim. Direct packed artifact scan also passes.
- Secret scanner self-test passes. Staged scan is required before commit.
- Original local audit tarball (since replaced by review artifact below):
  `/tmp/calendar-pack.1gOFqL/hasna-calendar-0.3.9.tgz`,
  SHA-256 `7b997d38dab6776d6d2dfd7d9028d6fcbbec63621cb214beb7fd8eef3d12a38f`.
  This is an unpublished audit artifact, not a released version or provenance claim.

No live database test, package publication, push, PR update, deployment,
credential change or data migration was performed. Independent exact-commit
review is still required; this document is implementation evidence, not approval.

## Review remediation — still NO_GO

The independent review reproduced three defects: Bun's driver-effective TLS
could be weaker than intended, event listing dropped offset/created_by, and
successful malformed response envelopes could masquerade as domain values.
All three are fixed in this follow-up; tenant enforcement is NOT fixed.

- PostgreSQL URLs require exactly one `sslmode=verify-full`; absent, weak,
  duplicate, case-variant or competing SSL/TLS settings fail before binding.
  Bun SQL also receives explicit verified TLS and hostname settings. Existing
  `PGSSLROOTCERT` and app-scoped CA files are validated before binding. No
  production or test plaintext exception exists. This follows Bun's documented
  [verify-full semantics](https://bun.sh/docs/runtime/sql).
- Offline TLS fixture exercises actual Bun 1.3.14 SQL: untrusted and wrong-host
  certificates fail, explicitly trusted matching-host certificate succeeds
  through TLS startup, and a server refusing TLS receives no plaintext startup.
  The same test sets hostile ambient TLS/PG variables to prove they do not
  weaken the explicit connection options. Certificates are synthetic temporary
  fixtures, not user credentials; no real database is contacted.
- All nondefault list filters now survive ApiStore, generated SDK and `/v1`,
  including creator and offset together. SDK generation is byte-identical on
  regeneration. Operation-specific singular/collection envelopes reject null,
  arrays in singular slots, object availability lists and malformed entities;
  genuine 404 remains absence. Missing agent update now returns actual 404.
- Tenant-A credentials can currently list/read/delete tenant-B organizations
  through the real router/store query path. Tests characterize this confirmed
  vulnerability, not passing isolation. See [TENANCY-GAP.md](TENANCY-GAP.md) for
  source evidence and required ownership/provisioning decisions. No invented
  tid-to-org mapping or withdrawal of global operations was introduced.
- Latest full suite: 239 pass, 12 live-PG skips, the same 3 unchanged baseline
  legacy-path failures; 781 assertions. Targeted review suite: 25 pass, 137
  assertions. Typecheck, frozen install, scoped Turbo build and release-bin
  checks pass. Root standard now passes 72/72, 138 assertions. Root names and
  dependency direction pass; exact unpublished canonical manifest validator
  passes. Todos remains unavailable under restricted PATH (NOT FILED).
- Updated audit artifact: 76 members, 0 artifact-scan findings/unreadable files;
  SHA-256 `f4d432c1a71f826cc6b09d8c7242af195c1fb5149e3510f4f8cd52c3fc4d831e`.
  Package/version remain unchanged and unpublished. Historical broad guard
  limitations above still apply; no aggregate publish-guard success is claimed.

Events integration, explicit db-migrate and legacy data remain untouched.
Tenant semantics, unpublished shared Contracts and package-wide gaps still
block release/deployment approval. This follow-up requires exact-commit review.

## Reserved-name envelope repair (2026-09-02)

- Owner: calendar_tenant_repair; registered commit trailer: fixer.
- Verified base: current PR #1489 head
  `fbb860631e0e94173103e5a664a07e06013ee2ee`; no Calendar implementation overlap
  beyond that draft. PR #459 remains separate manifest/artifact work.
- Branch: `codex/fixer/2026-09-02-calendar-tenant-envelope-repair`.
- Worktree: `/Users/hasna/Workspace/50-repositories/_worktrees/hasna/apps/calendar-tenant-envelope-repair`.
  The canonical clone and prior agents' worktrees were not edited.
- Exact-head reproduction confirmed genuine event search/conflict envelopes
  already worked. The remaining bug was applying their reserved path names to
  every resource and method: org slugs and agent names `search`/`conflicts`
  failed normal read/heartbeat validation; writes named `conflicts` also used
  the wrong envelope. Special shapes now apply only to event GET operations.
- Regression-first new suite: `1 pass / 3 fail` before the fix. Afterward,
  the focused new, SDK and review suites report `11 pass / 0 fail`,
  `271 expect() calls`. Coverage includes domain and SDK org/agent names,
  heartbeat, update/delete/absence, empty/nonempty genuine event queries,
  malformed shapes, prefixed/unprefixed paths and all 33 generated SDK verbs.
- Bun 1.3.14 frozen install with scripts disabled, typecheck and build pass.
  Uncached affected build against the exact PR base: `1 successful, 1 total`,
  with only `@hasna/calendar` in scope.
  The install's sole tracked side effect (Contracts CLI executable mode) was
  restored to its exact prior mode; no unrelated tracked diff remains.
- Full Calendar result: `243 pass / 12 skip / 3 fail`, `985 expect() calls`.
  The same three unmodified legacy path cases fail: home database discovery
  and two `/var` versus `/private/var` path comparisons. Twelve real-PostgreSQL
  cases remain unconfigured; the two passing tenancy exposure characterizations
  are evidence of unsafe behavior, NOT passing tenant-isolation gates.
- Root names and dependency direction pass. Manifests report `54/74` conform,
  `20 recorded exceptions`, `0 refusal(s)`; the released validator still rejects
  Calendar's PostgreSQL-only manifest. Root check was stopped with exit 143
  after unrelated Attachments `mapfile` and Connectors `vite` prepack failures.
  Calendar's individual dry-run scan reached `76 tarball entries, 76 contents
  scanned, 0 internal-infra strings`; the aggregate check did not pass.
- No tenant/authentication/query/schema behavior changed. Shared source requires
  issuer-tenant-to-service-org resolution but supplies no Calendar provisioning,
  global-agent, membership or administrative policy. See `TENANCY-GAP.md` for
  the exact evidence and proposed owner contract choices. No mapping was guessed.

No merge, publication, deployment, cloud change, data migration or station02
operation was performed. Independent exact-commit review is required before
pushing this follow-up; package-wide release blockers remain unchanged.
