# Unified Loops Product Contract

**Status:** Decision record; implementation target
**Scope:** One Loops application contract, its adapters, process roles, persistence choices, and compatibility path.

## 1. Decision, scope, non-goals, and vocabulary

### Decision

Loops is one product and one application contract. SQLite is its zero-configuration embedded-authority persistence; that embedded authority may be packaged or hosted without becoming the multi-tenant server role. PostgreSQL is the explicit persistence required by the network multi-tenant server role, including when that role runs on AWS. CLI, SDK, HTTP API, MCP, daemon/scheduler, runner, and server/admin are adapters or process roles over that one contract.

Deployment modes are removed: there is no product-mode enum and no
`HASNA_LOOPS_STORAGE_MODE` variable (it is not read anywhere). `local` and
`cloud` remain ordinary words
(a location; the hosted SaaS product), and "self-hosted" survives only as plain
English for a server someone runs. The only server-side switch is the data
backend (`sqlite | postgresql`, selected by configuration such as
`HASNA_LOOPS_DATABASE_URL`); clients connect via the local file or the
control-plane API, whose credential and authority resolve through the shared
`@hasna/contracts` 1.0.2 resolver (macOS Keychain, credential file, env, fleet
gateway default). Legacy mode values are not a compatibility input model.

### Scope

This record defines:

- the target authority-selection and configuration precedence;
- adapter ownership over a shared `LoopsApplication` capability contract;
- canonical executable, SDK, OpenAPI, MCP, and compatibility direction;
- storage, tenancy, recovery, migration, restore, and cutover invariants;
- evidence gates required before parity or cutover claims.

### Non-goals

This record does not:

- assert present parity between embedded and server deployments;
- assert live AWS readiness, a configured AWS environment, or an AWS rollout plan;
- assert a lossless SQLite-to-PostgreSQL migration is currently implemented;
- assert that there are no external consumers of the existing binaries or exports;
- introduce a dual-authority, cache-and-spool, offline write queue, or automatic replication product;
- prescribe credentials, endpoints, tenant identifiers, or environment-specific values.

### Vocabulary

| Term | Meaning |
| --- | --- |
| **Application contract** | The canonical capability, domain, and invariant contract implemented once by `LoopsApplication`. |
| **Authority** | The source of truth a client invokes: embedded application authority or a remote HTTP application authority. |
| **Persistence** | The backing store selected by an authority process: embedded SQLite or explicitly configured PostgreSQL. |
| **Adapter** | A boundary translating CLI, HTTP, MCP, SDK, daemon, or runner inputs into application capabilities. |
| **Process role** | The capabilities deliberately enabled in a process, such as client, scheduler, worker, server, or admin. |
| **Topology** | Operational placement and connectivity, such as a laptop process, a service fleet, or an AWS deployment. |
| **Readiness** | Evidence-backed ability to run a chosen role/topology safely; it is not a configuration mode. |

### Current versus target

Current implementation has contradictory mode and authority behavior: the
former `src/lib/mode.ts`, `src/lib/cloud/mode.ts`, and `src/lib/cloud/resolve.ts`
resolver chain disagreed with the generated storage kit. The 0.5.0 sweep
removes mode resolution entirely: authority and persistence resolve from the
storage/connection model (`storage: sqlite|postgresql`, `connection: file|api`).
- `src/lib/store/index.ts` can let `getStore` silently choose SQLite for database-only configuration.
- `ApiStore` getters can convert remote failures into apparent absence.
- `src/daemon/index.ts` directly creates local authority.
- `src/sdk/index.ts` and `src/sdk/http.ts` both export `LoopsClient`, while handwritten remote transport and generated SDK behavior diverge.
- Business logic is duplicated or embedded across CLI, API, MCP, and runner. OpenAPI omits rename/history-prune request bodies and query parameters. MCP `run-now` schedules work while local execution can run inline.

Target implementation routes every surface through one application contract with explicit authority, persistence, and role configuration; behavior selection by product modes is removed.

### Source-evidence anchors

| Source | Evidence anchored here |
| --- | --- |
| `package.json` | Six declared binaries, 13 public export entries, and the public `./mode` compatibility surface. |
| `hasna.contract.json` | Product metadata that currently declares mode-shaped runtime metadata (transitional: the contracts schema still requires `serviceSurfaces.deploymentModes` until the hotfix). |
| `src/index.ts` | Root export surface and compatibility exposure. |
| `openapi/loops.json` | HTTP operation/generation contract, Foundation status/version responses (the former `Foundation.mode` property is removed), and missing operation-shape coverage. |
| `src/api/index.ts` | Current HTTP adapter composition and application-boundary fragmentation. |
| `src/mcp/index.ts` | Current MCP tool composition, including `run-now` behavior. |
| `src/serve/index.ts` | Network server assembly, PostgreSQL runtime/auth/migrator separation, and signing/auth requirements. |
| `src/runner/index.ts` | Remote runner identity, claim, heartbeat, execution, and finalization composition. |
| `src/lib/scheduler.ts` | Current due selection, schedule advancement, retry, circuit, expiry, recovery, and execution policy. |
| `src/lib/store.ts` | Migration inventory evidence for total `daemonLeases` and expiration-filtered `activeDaemonLeases`. |
| `src/lib/storage/contract.ts` | Current policy-rich `LoopStorageContract`; evidence of migration debt at the application/storage boundary. |
| `src/lib/migration.ts` | Current workflows/loops/runs migration bundle and explicit skipped running/orphan run behavior. |
| `src/lib/storage/postgres-schema.ts` | PostgreSQL workflow-run provenance migration source. |
| `src/lib/storage/postgres-loop-storage.test.ts` | Targeted PostgreSQL provenance atomicity, conflict, and rollback test source. |
| `src/cli/index.test.ts` | Current storage/connection status, migration, and compatibility expectations. |

This table is a compact traceability anchor, not proof that the target contract is already implemented. The binary/export counts and adapter-fragmentation findings remain subject to the evidence gates in this record.

## 2. Orthogonal configuration axes

The following axes are independent. No single enum may collapse them.

| Axis | Choices | Rule |
| --- | --- | --- |
| Data authority | embedded application; remote HTTP application | Determines where a caller sends application commands. |
| Transport | in-process; CLI invocation; HTTP; MCP; SDK | Determines how a caller reaches the authority. |
| Persistence | SQLite; PostgreSQL | Chosen only inside an authority process. |
| Process role/capability | client; scheduler/daemon; runner/worker; server; admin | Enables explicit capabilities in a process. |
| Auth/tenant | embedded single-user context; authenticated multi-tenant context | Determines principal and tenant enforcement. |
| Topology | single machine; service deployment; AWS or other infrastructure | Describes placement, not behavior selection. |
| Readiness | unproven; tested; rehearsal-proven; production-ready | Is evidence status, not runtime configuration. |

Roles and topologies are not modes. Embedded SQLite authority may be packaged or hosted, but it is not the multi-tenant server role. The network multi-tenant server role requires explicitly configured PostgreSQL. An AWS deployment is still a topology, not a product mode, and a remote client never infers a storage engine from a DSN.

## 3. Fail-closed authority and persistence precedence

The process role is resolved explicitly from the executable/subcommand, SDK constructor, or MCP launch contract before authority or persistence is resolved. Configuration then produces exactly one complete role plan or a typed configuration error.

### Closed role-resolution matrix

| Explicit role | Authority and persistence | Complete required configuration | Absent configuration | Role-inapplicable or conflicting configuration |
| --- | --- | --- | --- | --- |
| Embedded client: CLI, SDK, or MCP | In-process `LoopsApplication`; SQLite | No authority inputs; optional SQLite location/configuration only | Defaults to SQLite | Remote endpoint/credential or any PostgreSQL DSN is rejected |
| Embedded scheduler/daemon | In-process `LoopsApplication`; SQLite | Explicit scheduler/daemon role; optional SQLite location/configuration only | Defaults to SQLite after the role is known | Remote client inputs or any PostgreSQL DSN is rejected |
| Remote client: CLI, SDK, or MCP | Remote HTTP `LoopsApplication` authority; no client-owned store | Complete endpoint plus client credential | Error; never creates SQLite | SQLite configuration, PostgreSQL DSNs, or incomplete remote inputs are rejected |
| Runner | Remote HTTP `LoopsApplication` authority; no runner-owned store | Complete endpoint, runner credential, and runner identity required by the claim/heartbeat protocol | Error; never creates SQLite | SQLite configuration, PostgreSQL DSNs, client-only credentials, or incomplete runner identity are rejected |
| Network multi-tenant server | HTTP authority; explicit PostgreSQL persistence | Complete runtime DSN, auth DSN, and signing/authentication inputs | Error; SQLite is not a server-role fallback | SQLite selection, remote-client authority inputs, privileged migrator DSN used as runtime DSN, or any partial server set is rejected |
| Admin/migrator | Explicit privileged administrative authority over PostgreSQL | Privileged DSN plus an explicit allowed administrative operation | Error; no default operation and no store creation | Runtime/client credentials used as privileged authority, missing operation, or mixed role configuration is rejected |

This matrix is closed: an unlisted role or role/configuration combination is unsupported and fails. Every partial, conflicting, ambiguous, or role-inapplicable configuration must fail validation **before any store, transport, scheduler, runner, or server is created**. Error details identify configuration categories without exposing credential values.

A PostgreSQL DSN never changes client authority. A remote transport, authentication, authorization, timeout, validation, or server failure is returned as a precise remote error and never falls back to SQLite or another local authority. The product makes no dual-authority, cache-and-spool, queued-write, or automatic reconciliation claim: one invocation has one selected authority.

Legacy mode inputs (mode-shaped env values) are deleted; configuration is
expressed only through the orthogonal axes. The client authority is decided by
the shared `@hasna/contracts` resolver; ambiguous, conflicting, partial, or
role-inapplicable configuration is rejected before resource creation.

## 4. One `LoopsApplication` capability contract

`LoopsApplication` is the sole owner of domain policy. It owns domain commands, queries, validation, authorization decisions, state-transition rules, and the orchestration of storage transaction boundaries. It alone decides:

- due-selection rules and stable ordering;
- schedule advancement;
- overlap, circuit-breaker, retry, expiry, and recovery outcomes;
- workflow definition/run/step/event transition semantics;
- goal, plan-node, and goal-run transition semantics;
- whether `run-now` schedules, claims, or executes through an available runner capability.

Its capability contract includes, at minimum:

- create, read, list, update, rename, pause, resume, delete, and history-prune loop operations;
- schedule evaluation, due-work discovery, recover, expire, claim, attempt advancement, execution finalization, and overlap handling;
- run-now semantics that explicitly state whether the capability schedules work or executes it through an available runner;
- migration/provenance inspection and approved administrative operations;
- typed result and error contracts that preserve remote/server failures rather than translating them to absence.

Storage adapters expose only explicitly specified atomic persistence primitives. They may enforce database constraints, uniqueness, compare-and-swap preconditions, transaction isolation, tenant context, and RLS, but they do not choose lifecycle policy.

| Application-owned operation | Target storage primitive |
| --- | --- |
| Select due work and decide the next schedule | Read candidate state plus atomically compare-and-swap the application-supplied schedule/claim transition under an expected version or state |
| Apply overlap, circuit, retry, expiry, or recovery decision | Atomically persist the application-supplied transition and evidence when preconditions still match |
| Advance an attempt | Compare-and-swap the expected attempt/state so one advancement wins |
| Finalize a run | Compare-and-swap the claim token/expected running state to one terminal result so one finalizer wins |
| Transition workflow run/step/event state | Apply the application-supplied transition and append its event in one transaction under expected parent/version preconditions |
| Transition goal/plan-node/goal-run state | Apply the application-supplied transition and evidence in one transaction under expected state/version preconditions |
| Prune or migrate state | Apply an explicit application-approved entity set with integrity checks; storage does not decide what is disposable |

The existing policy-rich methods in `src/lib/storage/contract.ts` are migration debt, not the target boundary. CLI, API, MCP, daemon, scheduler, runner, server, and SDK code must not call policy-bearing legacy `Store`, `LoopStorageContract`, planner, or scheduler paths directly. During migration, such calls must be routed behind `LoopsApplication`, then reduced to the target atomic primitives.

Adapters are thin and own only boundary concerns:

| Surface | Adapter ownership |
| --- | --- |
| CLI | argument parsing, display, exit-code mapping, and compatibility aliases |
| HTTP API | request validation, authentication extraction, response mapping, and OpenAPI conformance |
| SDK | typed caller ergonomics over the API contract; no duplicate domain semantics |
| MCP | tool schemas and application capability invocation with behavior matching CLI/API |
| daemon/scheduler | process lifecycle and invocation of scheduling capabilities |
| runner | process lifecycle and invocation of execution/finalization capabilities |
| server/admin | authority assembly, persistence selection, tenant context, and administrative boundaries |

No adapter may reimplement lifecycle decisions, silently substitute a store, reinterpret a remote failure as missing data, or bypass `LoopsApplication` to invoke a policy-bearing legacy path.

## 5. Executable, SDK, OpenAPI, and MCP direction

The canonical executable is `loops`, with explicit process subcommands for client, scheduler/daemon, runner, server, and admin responsibilities. It owns consistent configuration resolution and capability wiring.

The existing six binaries remain initially for compatibility. Five auxiliary binaries become thin shims that delegate to the canonical executable, preserve established invocation compatibility where possible, emit deprecation guidance, and contain no independent authority or business logic. Shim compatibility must be tested from packed artifacts, not only source-tree execution.

There is one primary public SDK. The generated remote client is derived from authoritative OpenAPI and is the remote transport foundation; handwritten transport must either be removed or reduced to a narrowly scoped generated-client wrapper with no divergent endpoint semantics. `src/sdk/index.ts` and `src/sdk/http.ts` must not continue to expose competing `LoopsClient` contracts.

OpenAPI is authoritative for every HTTP operation, including rename and history-prune request bodies and all supported query parameters. Generation drift is a release-blocking failure. MCP tools must map to the same application capabilities and return equivalent semantic outcomes. In particular, `run-now` must have one documented contract across MCP, CLI, HTTP, SDK, and embedded execution: scheduling versus inline execution must be an explicit capability/role distinction, never an adapter accident.

## 6. Storage and tenancy invariants

Both SQLite and PostgreSQL implementations must prove the same externally visible lifecycle invariants:

- recover, expire, and claim transitions are atomic;
- `expiresAt` is persisted and enforced;
- `expiresAfterRuns` (expiry after N consecutive successful runs) is persisted and enforced with circuit-breaker semantics: a success advances the streak, a final failure resets it, retryable failures and skipped runs are neutral, and the expiry marker restarts the streak on resume;
- `overlap=skip` is decided by `LoopsApplication` and atomically enforced by an application-supplied storage transition;
- an attempt advances exactly once;
- concurrent finalization has one winner and deterministic loser behavior;
- recovery and attempt history preserve workflow provenance;
- typed remote errors remain distinguishable from absence, validation errors, and authorization errors.

For multi-tenant PostgreSQL authority:

- tenant context is transaction-local;
- row-level security is forced;
- application, migration/admin, and operational roles are separated;
- authorization is enforced in both application and database boundaries where applicable.

Migrations are ordered, immutable, and checksummed. Unknown, altered, missing, or out-of-order migrations fail closed. SQLite backups use `VACUUM INTO` and require restore rehearsal. PostgreSQL transfer requires source/destination integrity proof, including expected migration identity, counts, hashes/checksums, provenance, and orphan detection before cutover is eligible.

### PostgreSQL workflow-provenance evidence

Current source includes a PostgreSQL workflow-run provenance migration and a targeted PostgreSQL test for atomic initial provenance, idempotency conflict, and rollback behavior. That is implementation and targeted test-source evidence; it is not an absence of implementation, but neither is it integrated parity proof.

| Provenance claim | State |
| --- | --- |
| PostgreSQL provenance migration exists in source | PRESENT |
| Targeted atomic conflict/rollback test exists in source | PRESENT |
| Targeted test executed successfully for the final candidate | UNKNOWN |
| Shared SQLite/PostgreSQL parity suite | RED |
| Cross-backend workflow/goal provenance semantics | RED |
| Object/filesystem provenance semantics | UNKNOWN |
| Same-final-SHA integrated evidence | RED |

## 7. Current P0 gaps: RED

The following gaps are **RED**. They block any embedded/server parity, safe-cutover, or readiness claim until closed with the evidence gates below.

| P0 gap | State | Claim blocked |
| --- | --- | --- |
| Hosted recovery and attempts parity | RED | hosted/server lifecycle parity |
| `expiresAt` parity | RED | expiration correctness parity |
| `overlap=skip` parity | RED | overlap safety parity |
| PostgreSQL workflow provenance integrated parity | RED | cross-backend audit/recovery provenance parity; implementation and targeted test source already exist |
| Complete no-loss SQLite-to-PostgreSQL cutover | RED | lossless migration/cutover |
| Broad remote error masking | RED | reliable remote absence/error semantics |

The former mode disagreement, silent database-only SQLite selection, direct daemon local authority creation, duplicated client exports, OpenAPI omissions, and adapter-level behavior divergence are also blocking architecture defects. They must be removed or contained behind tested compatibility boundaries before the target contract can be declared implemented.

## 8. Embedded single-user and server multi-tenant authentication

Embedded SQLite authority is a single-user deployment contract. It may use local process identity and does not imply multi-tenant hosting, remote credential validation, or tenant isolation.

Network server authority is a multi-tenant contract. It requires explicit selection of the server role, PostgreSQL runtime/auth configuration, signing/authentication inputs, authenticated principals, explicit tenant resolution, transaction-local tenant context, FORCE RLS, role separation, and precise authorization failures. Role is explicit before defaults are considered: absent authority configuration defaults to SQLite only for the embedded-capable roles listed in the closed matrix, never for runner, network server, or admin/migrator.

## 9. Compatibility, migration, refusal gates, rollback, and deprecation

Compatibility is boundary-only and time-bounded:

- legacy mode values are deleted and rejected at the boundary; there is no
  legacy mode compatibility input;
- all five published binaries follow the exhaustive binary disposition table below; the four non-canonical binaries begin as thin shims;
- all 13 package exports follow the exhaustive export disposition table below; none is removed or internalized before its consumer-evidence gate;
- compatibility shims must not preserve divergent stores, schedulers, transports, or lifecycle semantics.

### Legacy surface disposition

Canonical status and version responses emit orthogonal `storage`,
`connection`, `authority`, `transport`, `persistence`, `processRole`,
`authTenant`, `topology`, and `readiness` fields rather than a product mode.

#### Legacy mode value removal

The legacy mode values `local`, `self_hosted`, and `cloud` — and the
`HASNA_LOOPS_STORAGE_MODE` variable that carried them — were deleted in 0.5.0;
nothing in the package reads the retired variable any more. There is no mapping
table because there is no compatibility input: any
mode-shaped value is rejected before resource creation. Configuration is
expressed only through the orthogonal axes, with the storage backend
(`sqlite | postgresql`) and client connection (`file | api`) as the public
surface.

Canonical outputs never emit deployment-mode values as behavioral state;
status reports `storage` and `connection`. The deleted mode surface is not
reintroduced as a deprecated compatibility field.

| Current surface | Compatibility input/output behavior | Target mapping | Owner/test | Removal gate |
| --- | --- | --- | --- | --- |
| `src/lib/mode.ts` enum/resolver | Accepted and emitted mode-shaped values | Removed; mode exports renamed to the storage/connection model (breaking public export change in 0.5.0) | Resolver and status-output tests | Removal shipped in 0.5.0 |
| `hasna.contract.json` modes | Declared product modes and mode-shaped runtime metadata (transitional: the contracts schema still requires `serviceSurfaces.deploymentModes` until the hotfix) | Declare capabilities, storage support, roles, auth/tenant contract, topology compatibility, and readiness separately | Contract-schema validation | Contracts hotfix ships; legacy schema window closed |
| `openapi/loops.json` `Foundation.mode` and API status/version responses | Emitted mode-shaped service identity | `Foundation.mode` property removed; status/version responses carry storage/connection fields | OpenAPI validation, generation-drift check, generated SDK response tests | `mode` removed in 0.5.0; verified consumers migrated |
| CLI `mode`, `self-hosted`, and `cloud` commands plus `src/cli/index.test.ts` | Accepted legacy commands/config and emitted mode-shaped status | `loops mode` and `loops cloud status` removed; `loops status` reports storage + connection; `migrate`/`push`/`pull` promoted to top level | CLI status-output and packed binary tests | Commands removed in 0.5.0; `loops status` documented |
| SDK constructors/options | Embedded and remote clients can be selected through overlapping constructors/options | Explicit embedded and remote constructors/options feed one role resolver and one public SDK | SDK unit, generated-client, and resolver matrix tests | Ambiguous constructors removed only after typed migration path, verified consumer evidence, and deprecation gate |
| Documentation and configuration environment inputs | Documents or accepts mode-shaped environment values | Document explicit role, authority, persistence (storage backend), auth/tenant, and topology inputs; `HASNA_LOOPS_STORAGE_MODE` is deleted | Documentation examples plus configuration tests | Config migration guide shipped with 0.5.0 |

The five published binary entries, the removed `loops-api` compatibility binary,
and all 13 package export entries are exhaustively dispositioned below; their
inventory is not deferred.

#### Exhaustive binary disposition

| Binary | Target and shim behavior | Required parity test | Removal gate |
| --- | --- | --- | --- |
| `loops` | Canonical executable and subcommand dispatcher; owns role resolution and adapter wiring | Packed invocation, help/version, role resolution, argument, exit-code, and error-contract tests | Canonical binary is retained; any future replacement requires verified consumer evidence and an explicit superseding contract |
| `loops-daemon` | Thin forwarder to `loops daemon`; preserves supported arguments, signals, stdout/stderr, and exit status without owning scheduler policy | Packed shim versus `loops daemon` argument/config-error/signal/exit parity | Verified consumer inventory and migration, replacement available, deprecation window and semver gate complete |
| `loops-api` | **Removed from the package bin map.** The `./api` export and packed `dist/api/*` runtime/types remain public | Packed package rejects the bin while importing and smoking `@hasna/loops/api`; `loops status` covers operator status | Fleet caller survey found no invocation on reachable stations or registered runtime surfaces; removal ships as an explicit breaking PR with rollback to restore the bin and waiver together and revert the packed-boundary rejection |
| `loops-serve` | Thin forwarder to `loops server/admin`; contains no independent authority, migration, or auth policy | Packed shim versus canonical server/admin argument routing, startup refusal, signal, error, and exit parity | Verified server/admin consumers migrated, operational replacement rehearsed, deprecation window and semver gate complete |
| `loops-runner` | Thin forwarder to `loops runner`; contains no claim, heartbeat, retry, or finalization policy | Packed shim versus canonical runner identity/config refusal, signal, error, and exit parity | Verified runner consumers migrated, replacement operationally proven, deprecation window and semver gate complete |
| `loops-mcp` | Thin forwarder to `loops mcp`; preserves MCP transport framing while owning no tool semantics | Packed shim versus canonical MCP handshake, tool schema, framing, semantic error, and exit parity | Verified MCP consumers migrated, replacement compatibility proven, deprecation window and semver gate complete |

#### Exhaustive package export disposition

Raw storage and policy exports are compatibility debt and must not become the new application contract. Every deprecate/internalize target below remains import-compatible until verified consumer evidence, a replacement path, and the stated removal gate exist.

| Package export | Target disposition | Compatibility behavior | Owner/test | Removal or internalization gate |
| --- | --- | --- | --- | --- |
| `.` | **Keep** as canonical root, narrowed to application/domain types and approved top-level capabilities | Existing root names may forward through deprecated aliases, but no alias may bypass `LoopsApplication` | Public API owner; packed root import, type/API-surface, and no-policy-bypass tests | No removal planned; any breaking narrowing requires per-symbol consumer inventory, replacements, deprecation, and semver evidence |
| `./sdk` | **Keep** as the one primary public SDK | Preserve supported constructors through explicit embedded/remote adapters and the closed resolver | SDK owner; constructor/refusal, generated-client, type, and packed import tests | No removal planned; constructor removal requires verified consumer migration and semver gate |
| `./sdk/http` | **Deprecate**, then fold into `./sdk` | Forward to the generated remote transport exposed by the primary SDK; no competing `LoopsClient` semantics | SDK transport owner; generated parity, response/error, type, and packed import tests | Verified consumers migrated to `./sdk`, replacement stable, deprecation window and semver gate complete |
| `./serve` | **Deprecate**, then internalize behind `loops server/admin` | Forward only to canonical server/admin assembly; expose no independent authority policy | Server/admin adapter owner; startup-refusal, RLS/role, argument, and packed import tests | Verified programmatic consumers migrated, operational replacement proven, deprecation window and semver gate complete |
| `./mcp` | **Keep** as a thin public MCP adapter | Preserve MCP integration while routing every capability through `LoopsApplication` | MCP adapter owner; tool-schema, behavior parity, error, and packed import tests | No removal planned; any future removal requires verified consumer evidence and a replacement contract |
| `./api` | **Keep** as a thin public HTTP adapter | Preserve supported server integration points while deriving behavior and schema from `LoopsApplication` and OpenAPI | HTTP adapter owner; OpenAPI integration, auth/error, generation-drift, and packed import tests | No removal planned; any future removal requires verified consumer evidence and a replacement contract |
| `./runner` | **Deprecate**, then internalize behind `loops runner` | Forward programmatic entry points to canonical runner assembly; expose no claim/finalization policy | Runner adapter owner; identity/config refusal, claim/heartbeat/finalize delegation, and packed import tests | Verified programmatic consumers migrated, process replacement proven, deprecation window and semver gate complete |
| `./mode` | **Removed** in 0.5.0 | Mode exports renamed to storage/connection names (breaking public export change); canonical status is orthogonal | Role resolver owner; value/refusal, conflict, output, type, and packed import tests | Removal shipped in 0.5.0 |
| `./storage` | **Deprecate**, then internalize | Compatibility facade may forward storage access needed by existing consumers, but it cannot define or expose new lifecycle policy | Application/storage-boundary owner; compatibility, no-policy-bypass, and packed import tests | Per-symbol consumer inventory complete, application replacements shipped, consumers migrated, deprecation and semver gates complete |
| `./storage/contract` | **Deprecate**, then internalize the policy-rich contract | Existing types/methods remain compatibility-only while callers migrate to `LoopsApplication` and atomic persistence primitives | Application/storage-boundary owner; type compatibility, direct-call prohibition, and primitive contract tests | No external or internal policy-bearing callers, replacements proven on both backends, consumer/deprecation/semver gates complete |
| `./storage/sqlite` | **Deprecate direct application use**, then internalize behind embedded authority | Preserve existing imports without adding policy; implementation serves only the atomic persistence boundary | SQLite persistence owner; shared backend suite, migration/restore, no-policy-bypass, and packed import tests | Verified direct consumers migrated, embedded application replacement complete, shared parity and deprecation/semver gates complete |
| `./storage/postgres` | **Deprecate direct application use**, then internalize behind server/admin authority | Preserve existing imports without adding policy; implementation serves only atomic persistence, constraints, and RLS | PostgreSQL persistence owner; shared backend, disposable PostgreSQL, RLS/role, and packed import tests | Verified direct consumers migrated, server/admin replacement complete, shared parity and deprecation/semver gates complete |
| `./storage/postgres-schema` | **Deprecate direct use**, then internalize behind admin/migrator | Preserve migration/schema inspection needed by existing consumers without granting runtime policy ownership | Admin/migrator owner; ordered migration hash, unknown-migration refusal, role separation, and packed import tests | Verified consumers migrated to explicit admin operations, migration replacement proven, deprecation and semver gates complete |

### Authoritative-state migration classification

SQLite-to-PostgreSQL migration is a deliberate admin/migrator operation, not implicit client behavior. Every state category must be assigned exactly one candidate disposition: **transferred**, **deterministically rebuilt**, **intentionally volatile**, or **blocking**. Only a daemon lease proven expired and non-authoritative may be intentionally volatile; no other category currently has an approved deterministically rebuilt or intentionally volatile disposition.

| Authoritative-state category | Candidate classification | Current evidence and required disposition |
| --- | --- | --- |
| Workflows/definitions | Transferred | Current bundle includes workflows; per-entity counts, hashes, provenance, and destination proof are still required |
| Loops | Transferred | Current bundle includes loops; schedule/config hashes, parent references, and destination proof are still required |
| Runs/attempts | Blocking | Current bundle includes run rows but may skip running or orphan rows; candidate requires quiescence and zero skipped authoritative rows |
| Expired daemon leases | Intentionally volatile, conditionally | Each lease must be proven expired at the quiescence boundary and non-authoritative; disposal requires an explicit record containing lease identity, observed expiry, and disposition evidence |
| Active daemon leases | Blocking | Every lease counted by `activeDaemonLeases` is an active-authority signal and blocks migration until it expires or is cleanly relinquished and re-observed as inactive |
| Receipts/evidence | Blocking | Not covered by the current general bundle; transfer or an approved deterministic rebuild specification is required |
| Invocations | Blocking | Not covered by the current general bundle; identity, ordering, and provenance must be preserved |
| Work items | Blocking | Not covered by the current general bundle; ownership, admission, and references must be preserved |
| Workflow runs/steps/events | Blocking | Not covered by the current general bundle; transition/event order and parent integrity must be preserved |
| Goals/plan nodes/goal runs | Blocking | Not covered by the current general bundle; graph, lineage, status, usage, and evidence integrity must be preserved |
| Tenant/auth/config state | Blocking | Requires an explicit security-preserving transfer or approved rebuild/bootstrap procedure with role and tenant proof |
| Filesystem/object provenance | Blocking | Requires an inventory and content/object hashes, references, ownership, and restore semantics; database rows alone are insufficient |

The current bundle handles workflows, loops, and runs only, and it explicitly permits counted skips for running and orphan run rows. Therefore the general no-loss claim remains **RED**. Migration eligibility requires a quiesced source, zero active daemon leases, an explicit disposal record for every expired daemon lease, zero skipped authoritative rows, per-entity source/destination counts and hashes, provenance checks, orphan/reference reports, migration ledger identity, and successful restore proof. Any active lease, unrecorded expired-lease disposal, nonzero authoritative skip, unmatched entity, unresolved orphan, missing category disposition, or unproved filesystem/object reference is a refusal.

Rollback is defined before deprecation: retain a verified source backup, preserve ordered migration state, document the exact reversal boundary, and refuse destructive cutover steps when restoration proof is absent. The legacy mode values were removed in 0.5.0; binaries, exports, and handwritten transport are removed only after packed-shim, external-consumer, and migration evidence supports removal. External consumers remain **UNKNOWN** until independently inventoried.

## 10. Evidence gates and implementation sequence

Implementation must advance in this order; later claims are blocked by earlier RED or UNKNOWN evidence.

1. Define and test the closed authority/persistence/role resolver, including every supported row and all absent, partial, conflicting, ambiguous, and role-inapplicable configurations before resource creation.
2. Build the shared `LoopsApplication` capability contract and route embedded SQLite paths through it.
3. Add SQLite lifecycle tests for atomic recover/expire/claim, `expiresAt`, `expiresAfterRuns`, `overlap=skip`, exactly-once attempt advance, and one-winner finalize.
4. Run the same shared suite against SQLite and disposable PostgreSQL, with tenant/RLS/role tests for PostgreSQL.
5. Make OpenAPI complete and authoritative; fail CI on generation drift and test generated-client behavior.
6. Route CLI, HTTP, MCP, daemon, runner, and server/admin through thin adapters; prove `run-now` parity and precise remote errors.
7. Convert auxiliary binaries and compatibility exports to packed, tested shims.
8. Implement the complete authoritative-state classification and transfer/refusal checks; require quiescence, zero active daemon leases, an explicit disposal record for every expired daemon lease, zero skipped authoritative rows, and per-entity counts, hashes/checksums, provenance, and orphan/reference reports.
9. Perform SQLite backup/restore rehearsal and PostgreSQL transfer/restore proof in a disposable environment.
10. Run every mandatory resolver, SQLite/PostgreSQL parity, tenant/RLS/role, OpenAPI generation, generated-client, MCP, packed-shim, migration-integrity, and restore gate on the **same final clean integrated candidate SHA**.
11. Record that exact SHA with the complete evidence set and separately verify any live AWS state or external consumer inventory before making those claims.

Evidence from different SHAs cannot be composed into an integrated pass. Any source, schema, migration, or OpenAPI specification change invalidates the integrated evidence and requires the complete mandatory gate set to run again on the new final clean integrated candidate SHA.

No production cutover, parity announcement, or readiness statement is permitted merely because a code path or targeted test exists.

## 11. Objective checklist

| Objective | State | Required proof |
| --- | --- | --- |
| One application contract owns lifecycle semantics | UNKNOWN | adapter routing and capability tests at an exact SHA |
| No target public product-mode enum | DONE (0.5.0) | mode vocabulary removed; storage/connection model shipped; `HASNA_LOOPS_STORAGE_MODE` deleted |
| Absent authority configuration defaults to SQLite only for explicit embedded-capable roles | UNKNOWN | closed resolver matrix tests before resource creation |
| Remote clients require complete endpoint plus credential | UNKNOWN | closed resolver and remote integration tests |
| Runner requires complete remote authority and runner identity | UNKNOWN | claim/heartbeat identity and role-rejection tests |
| Network multi-tenant server requires PostgreSQL runtime/auth DSNs and signing/auth inputs | RED | closed resolver, server startup refusal, RLS, and role-separation tests |
| Admin/migrator requires explicit privileged DSN and operation | RED | operation allowlist, privilege separation, and refusal tests |
| Remote failures never fall back or become absence | RED | typed-error tests across API store, SDK, CLI, and MCP |
| SQLite/PostgreSQL lifecycle parity | RED | shared suite passing against SQLite and disposable PostgreSQL |
| Hosted recovery/attempts, `expiresAt`, `expiresAfterRuns`, and `overlap=skip` parity | RED | P0 regression suite and transaction evidence |
| PostgreSQL workflow provenance integrated parity | RED | existing migration and targeted test plus executed shared cross-backend suite at the final SHA |
| Complete authoritative-state SQLite-to-PostgreSQL no-loss cutover | RED | quiescence, zero active daemon leases, recorded expired-lease disposal, zero authoritative skips, category disposition, per-entity counts/hashes/provenance/orphans, and restore proof |
| OpenAPI and generated SDK are authoritative | RED | complete spec, generation-drift check, generated-client tests |
| MCP behavior parity | RED | equivalent capability and `run-now` tests |
| Five auxiliary binaries are thin packed shims | UNKNOWN | packed-artifact invocation tests |
| 13 compatibility exports have an owned deprecation path | UNKNOWN | export inventory and compatibility tests |
| Embedded single-user versus server multi-tenant auth boundary | UNKNOWN | authentication, transaction-local tenant, FORCE RLS, and role tests |
| All mandatory gates pass on one final clean integrated SHA | RED | one recorded SHA; any source/schema/migration/spec change reruns all mandatory gates |
| Live AWS readiness | UNKNOWN | independent live-environment evidence |
| External-consumer impact | UNKNOWN | independent consumer inventory |

Until every relevant RED is closed and every required UNKNOWN is evidenced, Loops must not claim parity, live AWS readiness, lossless migration, or absence of external consumers.
