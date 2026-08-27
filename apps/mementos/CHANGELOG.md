# Changelog

## 0.14.87

### Patch Changes

- 6adaf39: redact credential-shaped keys from list output on read (I24-00018) — collection list reads project credential-shaped keys out of JSON/YAML/CSV/compact output while preserving ordinary keys and required metadata.


## 0.14.86

### Patch Changes

- 5275dde: PgSyncPool responses are now generation-tagged (fixes 027d17e9): each query carries a monotonic generation echoed back in the shared status word, so a query that timed out is abandoned without its late response ever being consumed by the next query — the caller discards stale generations via a CAS re-arm instead of parsing the previous query's payload as its own result. The per-query timeout is overridable via MEMENTOS_PGSYNC_QUERY_TIMEOUT_MS for tests.

## 0.14.85 — Explicit truncation contract for list/stale/history reads

- Server list responses cap at 1000 rows and carry `total`/`limit`/`has_more`/`next_cursor`; the stale endpoint returns the true total instead of a silently capped page.
- CLI `list`/`history` with no `--limit` return the full population via a bounded page walk; `stale` JSON emits the true `stale_count`.
- In-package api-mode consumers (gatherer, io-export, memory_export) walk bounded pages so exports and training-data gathers cannot be silently truncated.
- Truncated 2xx cloud responses are reported as cloud failures naming the surface, never as unparseable CLI output.

## 0.14.84

## 0.14.83 — Bound complete project-resource traversal

- Bound complete traversal in both the internal producer and public SDK from
  the first page's declared total and effective page size, so endlessly
  changing cursor chains cannot run without limit.
- Reject repeated or missing continuation cursors and contradictory
  `has_more: false` pages that still provide a cursor, while preserving
  collection-revision, project, resource-kind, duplicate-ID, and final-count
  integrity checks.
- Reject non-positive SDK page sizes before fetching and keep the local,
  authenticated HTTP, CLI `--all`, and exact stable-ID readback paths aligned.

## 0.14.82 — Enumerate complete project resources

- Add `mementos project-resources <project-id>` plus local authority, REST,
  OpenAPI, and SDK surfaces to page, completely traverse, and exactly read
  project, knowledge, memory, and session resources by stable ID.
- Keep membership explicit to the project aggregate or an explicit project ID
  or active-project focus: unrelated memories stay outside, while later
  eligible children appear in the collection.
- Bind opaque cursors to the collection revision, reject stale cursors, and
  make CLI `--all` and SDK traversal fail closed on duplicate or incomplete
  stable-ID coverage across SQLite and authenticated HTTP/PostgreSQL.
- Resolve project authority from live package-owned configuration and withhold
  project-resource advertisement and guarded mutations when no explicit
  authority identity exists, rather than falling back to a synthetic tuple.

## 0.14.81 — Make guarded project repair callable

- Expose bounded guarded path update, exact sanitized receipt lookup, and
  receipt-scoped rollback through the package-owned project-registration
  authority on both local and authenticated HTTP transports.
- Preserve private canonical paths as request-only material: public results
  carry stable IDs, revisions, digests, operation lineage, and response bounds,
  while the snapshot-bearing generic receipts remain internal to Mementos.
- Keep caller-key replay deterministic, reject stale revisions without
  clobbering, restore the exact prior project row on rollback, and allow exact
  owned-path readback for existing bounded stable project IDs.

## 0.14.80 — Honor project pagination flags

- Apply explicit `--limit`, `--cursor`, and `--offset` windows to both JSON and
  human `mementos projects` output, including short and empty terminal pages.
- Preserve the no-flag `mementos --json projects` contract that returns the
  complete project list.
- Add an isolated CLI regression that proves JSON and human pagination against
  a deterministic five-project store.

## 0.14.79 — Accept npm's verified publish Sigstore bundle

**Immutable release recovery.** Version 0.14.78 was published only under
`release-candidate-0.14.78`, then failed registry verification before promotion:
npm 11.16.0 returned the npm publish attestation as a verified Sigstore v0.2
public-key bundle while the SLSA provenance attestation remained a Sigstore
v0.3 certificate bundle. Version 0.14.78 remains quarantined and must never be
promoted to `latest`; this release prepares the repaired candidate as 0.14.79.

- Accept only the exact predicate-specific npm-verified shapes: Sigstore v0.2
  with a registry public-key hint for the npm publish predicate, and Sigstore
  v0.3 with certificate material for SLSA provenance.
- Preserve the existing fail-closed DSSE signature, in-toto payload type,
  single positive transparency-log entry, exact statement and predicate,
  single sha512 subject, GitHub Actions identity, workflow, tag, commit, and
  one-publish/one-provenance cardinality checks.
- Add a red-first regression for the observed mixed bundle versions plus
  negative controls for unsigned, malformed, and unsupported bundle shapes.

## 0.14.78 — Validate the release Node executable

**Immutable release recovery.** Version 0.14.77 was tagged from protected main
but never published: the provenance process ran under Bun and compared Bun's
embedded Node compatibility version (`24.3.0`) with the separately installed
release Node executable pinned at `24.18.0`. The failed 0.14.77 tag remains
unchanged; this release prepares the repaired candidate as 0.14.78.

- Validate the actual external `node --version` output against exact release
  version `v24.18.0`, while preserving the exact npm `11.16.0` and Bun `1.3.14`
  checks.
- Add a Bun-executed regression with controlled external Node executables:
  the exact version advances past the toolchain gate, while a mismatch is
  rejected with the observed executable version in the diagnostic.

## 0.14.77 — Receipt-backed project registration authority

**Immutable release recovery.** Version 0.14.76 was tagged but never published:
its release workflow invoked the package-local `contracts` binary as a raw shell
command, outside Bun's package-runner path, and exited `127`. This release keeps
that failed tag unchanged and publishes the repaired candidate as 0.14.77.

**Provenance note.** The 0.14.77 release tag is cut from this protected-main provenance follow-up after the content-identical metadata merge, preserving published history without rewriting it.

**Additive authority path.** Integrations can now create a project only when
absent, read it back by exact full ID, retrieve an immutable bounded terminal
receipt, and compensate only the unchanged object created by that accepted
receipt. Existing `registerProject` callers retain their current behaviour.

- Adds the opt-in `mementos.project-registration.v1` authority across SQLite
  and authenticated HTTP/PostgreSQL, with deterministic idempotency keys,
  normalized request digests, exact destination identity, revisions, and
  duplicate-of attribution.
- Byte-identical retries return the stored accepted result; a pre-existing
  project is a terminal no-clobber outcome with zero mutation. Ambiguous
  post-commit results reconcile through exact receipt lookup, bounded to
  `max_items=1`.
- Receipt-scoped inverse deletes only the unchanged project created by that
  receipt. It refuses deletion when the project has drifted or any of the 14
  supported project-reference surfaces is populated.
- Canonical paths remain private authority inputs. Receipts expose full IDs
  and bounded evidence instead of returning the path. (#56)

### Also carried by this release

- Add exact stable-ID project updates and guarded compare-and-swap updates with
  immutable receipts, idempotent replay, and exact rollback. (#57, #59)
- Resolve CLI `--agent <name>` filters on read paths instead of silently
  returning an empty result. (#60)
- Apply `agent_id` and `project_id` filters in `/api/memories/search` instead
  of discarding them. (#61)
- Test-only: isolate API-mode project-update tests from local database path
  selectors. (#58)
- Run the release contract scan through `bun run contracts`, with a two-sided
  regression proving the raw shell invocation fails in an isolated environment
  while the package-runner invocation resolves the repository dependency. (#67)

## 0.14.73 — `save` refuses an unresolvable `--agent`/`--project`

**Behaviour change.** `mementos save` no longer discards a scoping flag it
cannot resolve.

- `save` now exits `1` when `--agent` or `--project` names something that does
  not resolve, instead of dropping the flag and writing at rc=0. Both flags are
  fixed at the same site, because repairing one leaves the mechanism live on the
  other. A row owned by a real agent was already protected by the existing fork
  guard; the damage was confined to the **unowned** bucket — 826 of 1185 active
  rows, 69.7% — where the save silently overwrote and misattributed. (#43)
- `save` now **warns** when the global `--session` flag receives a scope word
  (`shared`/`private`/`global`) — the guard `update` already had. Warn rather
  than throw, deliberately: roughly 80 live call sites depend on rc=0 today, and
  throwing would convert a documentation bug into a fleet outage. Those sites
  write `session_id="shared"` with scope left private and record the opposite of
  what they claim; fleet-wide, 96 of 1142 active rows carry a session_id that is
  literally a scope word. (#42)
- The fork-refusal message compared four columns and printed three, omitting
  `agent`. Where agent was the sole difference the message was self-contradictory
  — identical scope, project and session on both sides, and a refusal anyway. It
  now names the column that actually differs. (#42)

### Upgrade note

`--agent` and `--project` change from fail-open to fail-closed, so a caller
passing an unregistered name now fails loudly where it previously succeeded and
misfiled. Measured before merge: zero of 74–85 `mementos save` call sites across
the skill homes pass either flag. Seats passing one by hand will be told to run
`mementos register-agent <name>` — 347 of 500 live conversations identities are
absent from the mementos registry.

Already-damaged rows are **unrecoverable**: `createMemory` writes the same value
to both `agent_id` and `created_by_agent`, so an overwritten row is
indistinguishable from a legitimately unowned one.

### Also carried by this release

- Test-only: the two subprocess-heavy CLI tests in `src/cli/index.test.ts` now
  carry an explicit 60000ms budget. Each spawns a CLI subprocess per assertion
  setup step (27 and 14 spawns) and costs 19.00s and 11.22s against the suite's
  10s default, so `list compact` failed deterministically on a contended box.
  Read as flakiness for a long time because a timed-out test reports the
  **budget**, not the duration. No assertion is relaxed. This also unblocked
  `npm publish`, whose `prepublishOnly` runs the same suite — two publish
  attempts of 0.14.72 aborted on that one test. (#41)

## 0.14.72 — `recall` matches exactly; fuzzy fallback is opt-in

**Behaviour change.** `mementos recall <key>` no longer substitutes a different
record when the requested key is absent.

- `recall` now matches the exact key and exits `1` when it is missing, printing
  no record at all. The fuzzy fallback moves behind `--fuzzy`, which returns the
  nearest record and exits `2` — distinct from `1`, so a shell `if` reads it as a
  miss while a caller that cares can still tell a neighbour from an empty result.
  `--json` substitutions carry `fuzzy_match`, `requested_key` and `returned_key`.
- `get` is registered as an alias of `recall`. It previously did not exist and
  exited `1` with `unknown command`, which is indistinguishable from a genuine
  miss to anything reading only the exit status.
- The exact path now asserts that the returned record's key equals the requested
  key before treating it as a hit, so the guarantee holds in the command rather
  than depending on both store backends keeping an exact filter.

The previous behaviour failed **closed** on an invented key (exit `1`) and
**open** on a near miss (exit `0`, different record). Every negative control
built from an invented string therefore passed while the command was
substituting records, which is why this survived so long; the regression suite
added here exercises the near-miss arm specifically.

### Exit codes, stated plainly because callers script against them

| case | before | 0.14.72 |
| --- | --- | --- |
| exact key present | `0` | `0` (unchanged) |
| near-miss key, no `--fuzzy` | `0` + a different record | `1`, no record printed |
| key absent entirely | `1` | `1` (unchanged) |
| near-miss key, with `--fuzzy` | n/a | `2` + the neighbour |

A caller that treats any non-zero as "not found" keeps working. A caller that
relied on a bare `recall <key>` returning a neighbour must now pass `--fuzzy`.

### Also carried by this release

These landed on `main` after 0.14.71 was published and ship here for the first
time; they are unrelated to the `recall` change.

- Stop destroying the global config file when it is unparseable (#27).
- Align with `@hasna/contracts` conformance (moderate) for the mementos app (#18).
- Add mementos project-panel contract fixtures.

## 0.14.68 — Harden storage cloud-runtime diagnostics

Adds an explicit, fail-closed cloud-runtime status contract and safe migration
diagnostics for the storage subsystem (rebased onto the reconciled `main`).

- `getStorageStatus()` now publishes a structured `runtime`
  (`mementos-cloud-runtime-v1`) contract describing the local SQLite primary
  runtime, unsupported local file sync, PostgreSQL/RDS remote adapter, and
  unsupported S3/AWS mutation, with fail-closed flags and redacted URLs.
- Remote PostgreSQL/RDS configuration fails closed for missing, invalid, or
  non-Postgres connection strings via `validatePostgresConnectionString`, and
  `redactDatabaseUrl` now redacts credential-bearing URL userinfo **and**
  secret-like query parameters (password/token/secret/api_key/…).
- Adds `mementos storage migrate --dry-run` (CLI + MCP) safe diagnostics via
  `getPgMigrationDiagnostics`: no network, no AWS/production mutation,
  credentials redacted; live apply still validates and requires approval.
- README and regression coverage updated for env precedence, redaction,
  fail-closed behavior, and CLI/MCP parity.

## 0.14.67 — Reconcile `main` with the published npm line

`main` (0.14.52) had diverged from the deployed/published npm line: it was
5 commits ahead and 21 commits behind `npm/mementos/v0.14.66`, so fixes based
on `main` were targeting stale code. This release reconciles the two by merging
the published release tag `npm/mementos/v0.14.66` into `main`, preserving both
histories via a true merge commit, then re-applying the genuine `main`-only
fixes on top of the published (source-of-truth) code.

### Reconciliation

- Merged the published release tag `npm/mementos/v0.14.66` into `main`. All
  runtime conflicts were resolved in favor of the published line (the source of
  truth for deployed behavior): the full cloud/self-hosted api-mode routing
  series, bulk-upsert + FK auto-provision server route, RDS DSN confinement,
  Postgres-safe server fixes (INSTR→STRPOS, int8 parsing,
  COALESCE(accessed_at, updated_at), entity merge/partial-id), URL-decoded route
  params, and cloud-aware doctor/clean.

### Preserved / re-applied `main`-only fixes

- **fix(completions):** derive the subcommand list from the commander registry
  instead of a hand-maintained string (#11).
- **fix(cli):** honor `--json` in
  hooks/synthesis/session/profile/auto-memory/brains/get-focus (#13).
- **fix(stats):** `by_status` buckets partition `total` instead of
  double-counting (#12). The published line had consolidated the three stats
  surfaces into a shared `getMemoryStats()` (`src/db/analytics.ts`) that still
  used `GROUP BY status` without the active filter, so this fix was re-applied
  in that single shared source (`WHERE status = 'active' GROUP BY status`) —
  cleaner than the original three-site patch.

### Dropped (superseded)

- **feat(client): self_hosted cloud-store routing (#8)** and
  **fix(client): fall through when mode=cloud but no API URL+key (#9)** — the
  `src/db/cloud-store.ts` approach was fully superseded by the published line's
  more complete `src/db/api-mode.ts` routing (with dedicated
  api-mode-guard/api-mode-routing/cloud-mode test suites). The orphaned
  `cloud-store.ts` (+ tests), its `resolvePartialId` hook in `database.ts`, the
  `src/mcp/http.ts` changes, and the `@hasna/mcp-harness` `file:` dependency it
  introduced were removed so no api-mode split-brain is re-introduced.
