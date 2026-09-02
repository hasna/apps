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

## Verification evidence

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
- Final local audit tarball: `/tmp/calendar-pack.1gOFqL/hasna-calendar-0.3.9.tgz`,
  SHA-256 `7b997d38dab6776d6d2dfd7d9028d6fcbbec63621cb214beb7fd8eef3d12a38f`.
  This is an unpublished audit artifact, not a released version or provenance claim.

No live database test, package publication, push, PR update, deployment,
credential change or data migration was performed. Independent exact-commit
review is still required; this document is implementation evidence, not approval.
