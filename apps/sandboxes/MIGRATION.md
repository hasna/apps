# iapp-sandboxes migration plan

Investigation + local staging only. No repos created/transferred, no visibility change, no npm publish, no AWS mutation, no code deleted. Read-only AWS + local clone + this report only.

## 0. Snapshot / provenance

- Source repo: `hasna/sandboxes` (private). Cloned via `gh` into
  `/home/hasna/workspace/hasnaxyz/internalapp/iapp-sandboxes`.
- **There is NO `main` branch.** Remote HEAD (default) = `build/managed-adapters-v1`.
  Trunk is fragmented across 11 divergent WIP branches (build/*, fix/*, integration/*).
- Default branch cloned first: `build/managed-adapters-v1`
  - HEAD `35d9295e4ff9b41ec8117efdc76add85afb6b0c3` (2026-07-11), name `@hasna/sandboxes`,
    version `0.0.0-v1-managed-adapters`. Slim 30-file **managed-adapter library only**
    (no CLI/service/API). NOT the app.
- Fullest / most-canonical app branch = `fix/v2-effect-transitions`
  - HEAD `8b71a53` (2026-07-12 20:39), name `@hasna/sandboxes`, version **`1.0.0`**,
    103 files, ~35,692 src LOC, 33 test files (~401 `test()` calls, matches ~419 claim).
  - Local working tree checked out to `stage/fix-v2-effect-transitions` (tracks this) for staging.
- Branch landscape (files / version / last commit):
  - build/managed-adapters-v1  30  0.0.0-v1-managed-adapters  2026-07-11 (default HEAD)
  - build/sandboxes-v1         46  1.0.0  2026-07-10
  - integration/sandboxes-v1-foundation 77 1.0.0 2026-07-11
  - integration/e2b-live-v1    84  1.0.0  2026-07-11
  - build/disposable-task-v1  100  1.0.0  2026-07-12
  - build/daytona-provider-v1 102  1.0.0  2026-07-12
  - **fix/v2-effect-transitions 103 1.0.0 2026-07-12 (fullest)**
- Tags: **none**.

## A. Surfaces — API / CLI / SDK / MCP

Scanned ALL 11 branches for HTTP server / `/v1` routes / MCP.

| Surface | Present? | Where / gap |
|---|---|---|
| **API (/v1 + /health + key auth)** | **NO** | No `Bun.serve`/`listen`/`createServer`/`/v1`/`/health`/`x-api-key` anywhere in src on any branch. `src/service.ts` (5,642 LOC) is a domain **service class**, not an HTTP server. Must be BUILT (model on `hasna/todos` gold /v1) wrapping `service.ts` over `repository-postgres.ts`. |
| **CLI** | Partial | `src/cli.ts` (270 LOC) exists but is a **local-SQLite tool** — imports `SqliteSandboxRepositoryV1`, opens a DB under `homedir()`. It is NOT an API client. Must be rewritten to call `/v1` with `HASNA_SANDBOXES_API_KEY`. |
| **SDK** | Partial | `src/index.ts` (21 LOC) re-exports domain primitives + `service.ts` — a **library**, not an API client. Needs an added `/v1` API client (fetch + bearer). |
| **MCP** | **NO** | No `modelcontextprotocol` server anywhere (only unrelated string in `adapters/managed/sdk-pins.ts`). Must be BUILT (model on `hasnaxyz/iapp-wallets` MCP). |

**Key conclusion:** this is NOT a "strip local mode" migration like wallets/todos. It is a
**BUILD**: 3 of 4 network surfaces (API, MCP, API-mode CLI/SDK) do not exist. What the repo
provides is a rich domain layer (service, types, validation, effect-journal, provider
adapters for Daytona/E2B) + a local CLI + a library SDK. Size = **XL**.

## B. Single-mode removal (local / SQLite / dual-mode / dead code)

Storage is triple-backend: `backend: "memory" | "sqlite" | "postgres"` (`repository.ts:143`).
Self-hosted policy → keep **postgres only** (server-side RDS); clients go through /v1.

Remove / rewrite (fullest branch LOC):
- `src/repository-sqlite.ts` — **1,123** LOC — DELETE (SQLite backend).
- `src/repository-memory.ts` — **438** LOC — DELETE (in-memory backend).
- `src/repository.ts` — 204 LOC — trim backend union to `postgres`; keep interface.
- `src/cli.ts` — 270 LOC — REWRITE (SQLite-direct → /v1 client).
- `src/object-store.ts` — local encrypted **filesystem** object store (node:fs + crypto,
  NOT S3) — replace with S3 store (bucket exists, see D).
- `src/adapters/managed/checkpoint-handoff-encrypted-local.ts` — **1,200** LOC — "local"
  encrypted checkpoint handoff → port to S3 or drop if superseded.
- SQLite-specific test files under `tests/` (subset of 33).
- KEEP: `migrations/*` are **postgres** `.sql` (disposable-task-journal 0001-0003,
  durable-journal-witness 0001) — keep for server.
- Approx direct removal ~1,765 LOC (sqlite+memory) + ~2,400 LOC object-store/checkpoint
  rework + full cli rewrite. Provider adapters (daytona/e2b, disposable-task-postgres
  3,186 LOC) are core — keep, but verify none are "local-only".

## C. package.json edits (from fullest branch 1.0.0 baseline)

- `name`: `@hasna/sandboxes` → **`@hasnaxyz/sandboxes`**.
- `version`: 1.0.0 (already MAJOR — confirm 1.0.0).
- `private: true` + `publishConfig.access`: `public` → **`restricted`**, keep
  `registry: https://registry.npmjs.org`.
- `bin`: currently `{ "sandboxes": "dist/cli.js" }` → add **`"sandboxes-mcp": "dist/mcp.js"`**.
- `exports`: keep `.` (SDK); DROP `./postgres` (server-internal, not a client export);
  drop `./managed` if managed lib is not part of the client SDK (decide — likely keep as
  server-internal, not exported).
- `scripts`: add `start`/`serve` (API server), `dev`; keep build (add mcp.ts + server.ts
  entrypoints to `bun build`); drop SQLite-only test scripts.
- `dependencies`: keep `@daytona/sdk` 0.193.0, `e2b` 2.31.0, `@types/ws`; ADD API server
  framework used by gold `hasna/todos` (verify: hono/native Bun.serve) + MCP SDK. Nothing
  to drop except once SQLite removed, `bun:sqlite` is builtin (no dep). Keep `overrides`.
- Author/license: internal iapp — set license per iapp policy (currently Apache-2.0/public).

## D. AWS / deploy (READ-ONLY, verified account 789877399345 / us-east-1)

- **Live self-hosted: YES (but placeholder).** `https://sandboxes.hasna.xyz/health` →
  `{"status":"ok","version":"0.2.5","mode":"remote","name":"sandboxes"}`. `/v1/health`
  correctly requires api-key (`missing_token`). Root → 404.
- **Provenance gap:** deployed version **0.2.5 matches NO branch and NO tag** (branches are
  1.0.0 / 0.0.0-v1). Health shape is the generic shared OSS-app scaffold. **The real
  sandboxes domain server was never deployed — the route fronts a placeholder.**
- ECS: cluster `oss-fleet-prod`, service `sandboxes-prod` ACTIVE, desired=1 running=1,
  taskDef `sandboxes-prod:6`, image `789877399345.dkr.ecr.us-east-1.amazonaws.com/sandboxes@sha256:e23e24a7...`.
  - Task env: `HASNA_SANDBOXES_STORAGE_MODE`, `HASNA_APP_MODE`, `HASNA_APP_NAME`, `PORT`, `LOG_LEVEL`, `AWS_REGION`.
  - Task secrets (names only): `HASNA_SANDBOXES_DATABASE_URL`, `HASNA_SANDBOXES_API_SIGNING_KEY`.
- **Routing blocker RESOLVED:** ALB `oss-fleet-alb` :443 rule prio 1026 host
  `sandboxes.hasna.xyz` → TG `sandbo20260706140544078700000001` (port 8080, HC `/health`),
  **target health = healthy**. (This was the blocked routing root; it is now green — but
  green against the placeholder.)
- RDS: `hasna-xyz-infra-apps-prod-postgres` **available**, postgres 16.4 (shared apps DB).
- S3: bucket **`hasna-xyz-opensource-sandboxes-prod` EXISTS** (currently unused by code —
  object store is local FS; needs S3 port).
- Secrets (names only, values NEVER printed): `hasna/oss/sandboxes/database-url`,
  `.../database-url-owner`, `.../api-key-signing-secret`, `.../api-key`, plus
  `hasna/xyz/opensource/sandboxes/prod/{s3,aws,env}`. **Provider creds (Daytona/E2B) NOT
  yet present** — must be added (e.g. `hasna/oss/sandboxes/provider-*`) and injected server-side.
- Deploy artifacts: **NO Dockerfile / ECS task-def / CI deploy in ANY branch** — must be
  created (model on `platform-mailery` / other iapp deploy pipeline).

## E. Ordered migration checklist

1. **Consolidate trunk FIRST (blocker).** Merge/rebase the fullest `fix/v2-effect-transitions`
   (+ any unique work from daytona-provider-v1 / disposable-task-v1 / e2b-live-v1) into a new
   canonical `main`. No safe migration until one trunk exists.
2. Rip out local mode: delete `repository-sqlite.ts`, `repository-memory.ts`; trim
   `repository.ts` to postgres-only; delete SQLite tests. Verify build + postgres tests green.
3. Port object storage: replace local FS `object-store.ts` + `checkpoint-handoff-encrypted-local.ts`
   with S3 (bucket `hasna-xyz-opensource-sandboxes-prod`).
4. **BUILD API server** (`src/server.ts`): public `/health`, `/v1/*` under api-key auth,
   wrapping `service.ts` over `repository-postgres.ts`. Model on `hasna/todos` /v1.
5. **BUILD MCP server** (`src/mcp.ts`) as /v1 client. Model on `hasnaxyz/iapp-wallets`.
6. **Rewrite CLI** (`src/cli.ts`) as /v1 client (`HASNA_SANDBOXES_API_URL` +
   `HASNA_SANDBOXES_API_KEY`); add SDK /v1 client to `index.ts`.
7. Provider wiring: add Daytona/E2B creds to Secrets Manager; inject at server; keep
   provider adapters server-side only (never on clients).
8. package.json edits per section C.
9. Deploy artifacts: Dockerfile + ECS task-def (bump `sandboxes-prod`) + CI. Build image,
   push to ECR `sandboxes` repo, deploy new taskDef revision.
10. Cutover: verify new `/v1/health` + real domain endpoints behind api-key; confirm ALB TG
    stays healthy (HC `/health` on :8080) against the REAL server, not placeholder.
11. **GitHub rename** `hasna/sandboxes` → `hasnaxyz/iapp-sandboxes` (private). **npm rename**
    `@hasna/sandboxes` → `@hasnaxyz/sandboxes` (restricted), publish 1.0.0.
12. **Rollback:** ECS keeps prior taskDef revision (`sandboxes-prod:6`) — one-click roll
    back to placeholder; DNS/ALB rule unchanged; local clone/branches untouched; old
    `@hasna/sandboxes` name left deprecated (don't unpublish).

## F. Blockers + size

Size: **XL** (task hint said L — upgrade: 3 of 4 surfaces are greenfield, ~35k LOC domain
+ live provider integration tests).

Top blockers:
1. **No trunk branch** — no `main`; 11 divergent WIP branches must be consolidated before anything.
2. **3 surfaces don't exist** — API server, MCP, and API-mode CLI/SDK must be built from
   scratch; repo is a local library+CLI, not a self-hosted app.
3. **Deployed v0.2.5 is a placeholder** — real domain server never shipped; ALB/TG healthy
   but fronting a scaffold. Routing target-group blocker itself is resolved (healthy).
4. **Provider credentials not provisioned** (Daytona/E2B) and not wired to a server layer.
5. **Local object-store/checkpoint** uses filesystem encryption; S3 bucket exists but unused
   — must port before self-hosted parity.

## Users & Tenants

Added by the multi-tenancy design pass. INVESTIGATION + PLAN ONLY — no code/AWS mutated.
Since 3 of 4 surfaces (API/MCP/API-mode CLI+SDK) are greenfield, tenancy is baked in from
the first `/v1` line rather than retrofitted. Central `identities` IdP is authoritative for
login/signup + API keys; sandboxes is a **resource server** that trusts identities-issued
tokens and enforces tenant scoping locally.

### 1. Existing owner/agent/allocation notions (what exists today — cite)

There is **NO tenant/account/user_id anywhere.** The only "who" today are cryptographic
principals minted by an external "Infinity" authority, not org accounts:

- **Principals (crypto, not accounts):** `actor_principal`, `lease_holder_principal`,
  `operation_executor_principal` — on the fence (`types.ts:88-90` `CanonicalSandboxEffectFenceV1`),
  persisted on the sandbox (`types.ts:554-556` `SandboxV1`) and on the `operations` table
  (`repository-postgres.ts:134` `actor_principal TEXT NOT NULL`, uniqueness
  `UNIQUE(actor_principal, operation, resource_id, idempotency_key_sha256)` line 171). These
  are capability subjects, NOT tenants — they can't be used as an isolation boundary.
- **Allocation:** `CreateSandboxV1.allocation_key_sha256` (`types.ts:456`); lease/claim
  mechanics `allocation_lease_epoch` / `allocation_claim_fence_sha256` /
  `allocation_ownership_nonce_sha256` in disposable-task-journal
  (`migrations/disposable-task-journal/0001_*.sql:69-73`). Ownership = lease, not account.
- **Sandbox/resource identity:** `sandboxes.sandbox_records(resource_id PK)`
  (`repository-postgres.ts:118-123`); `resource_id` is the canonical allocation handle.
- **Provider scope (closest to per-tenant creds today):** `installation_id` +
  `provider_scope_ref` (`service.ts:483-498` `providerLifecycleLockKey`,
  `types.ts:976-990` `OwnedProviderHandleV1`) — a SINGLE global installation/scope per
  adapter (`fake|e2b|daytona_cloud`). Provider creds not yet provisioned (plan §D).
- **Checkpoints/blobs:** `sandboxes.checkpoints`, `checkpoint_blobs`,
  `immutable_checkpoint_receipts` (`repository-postgres.ts:205-220,341-349`) — keyed by
  `checkpoint_id`/`resource_id`, **no tenant**.
- **Object store keys:** purely content-addressed `objects/sha256/<ab>/<hex>.object`
  (`object-store.ts:291-294`) — **no tenant prefix** (same gap will exist in the S3 port).

Conclusion: tenancy is a NEW orthogonal dimension. Crypto principals stay as-is (they secure
the effect journal); `tenant_id`/`user_id` are layered ABOVE them as the account boundary.

### 2. Tenant + User model

- **Tenant** = a signup account in central `identities` (the billing/isolation boundary).
  Every sandbox allocation, exec, checkpoint, receipt, event, and provider-quota row belongs
  to exactly one tenant. Default fail-closed: a request with no resolvable `tenant_id` is
  rejected (`403 tenant_required`), never silently global.
- **User** = a member of one-or-more tenants; two kinds: `human` and `agent` (service
  identity). Authoritative in `identities`; sandboxes stores a thin local projection keyed by
  the identities-issued stable id so FKs + audit work offline and fail-closed.
- **Membership/roles** (per (tenant_id,user_id)): `owner` (manage members + provider creds +
  quota), `operator` (allocate/exec/checkpoint/destroy), `viewer` (read status/frames/results),
  `agent` (operator-equivalent, non-interactive; the common fleet case). Roles gate `/v1`
  scopes; they do NOT replace the Infinity capability check on lifecycle ops — both must pass.

### 3. Auth binding — key/session → (tenant_id, user_id, scopes)

- `identities` issues a bearer (API key or session JWT) carrying `tenant_id`, `user_id`,
  `user_kind`, and `scopes` (e.g. `sandboxes:allocate`, `:exec`, `:checkpoint`, `:read`,
  `:admin`). Sandboxes verifies the token (introspection or shared JWKS from identities),
  then binds an immutable request context `{tenant_id, user_id, scopes}`.
- **Every `/v1` allocate/exec/checkpoint/destroy/read is tenant-scoped**: the resolved
  `tenant_id` is injected into WHERE clauses server-side and asserted against the row's
  `tenant_id` (fail-closed — a cross-tenant `resource_id` returns `404 not_found`, never the
  row). `user_id` is recorded as the requester on the allocation + each operation for
  attribution and audit; it maps down onto the existing `actor_principal` chain (the principal
  becomes `tenant:<id>/user:<id>` or a value derived from it) so the effect journal stays
  intact.
- **S3 object-store keys are tenant-prefixed:** `sandboxes/<tenant_id>/objects/sha256/<ab>/<hex>`
  (replacing the flat `object-store.ts:291-294` scheme). Prevents cross-tenant blob reads even
  on sha collision-guessing; enables per-tenant lifecycle/cost policies and per-tenant deletion.
- **Provider credential selection per tenant:** map `(tenant_id, adapter_id)` →
  `installation_id` + `provider_scope_ref` + Secrets-Manager credential ref. Default = one
  SHARED Hasna installation per adapter (all tenants pooled) for launch; schema supports a
  tenant supplying its own Daytona/E2B account later (BYO-provider) with zero migration. Creds
  are resolved server-side only — NEVER sent to clients (upholds CLAUDE.md §2 forbidden list).

### 4. Concrete schema (new + altered)

New tables (thin local projections + tenancy control), all in `sandboxes` schema:

```sql
CREATE TABLE sandboxes.tenants (
  tenant_id      TEXT PRIMARY KEY,              -- from identities
  slug           TEXT NOT NULL UNIQUE,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE sandboxes.users (
  user_id        TEXT PRIMARY KEY,              -- from identities
  user_kind      TEXT NOT NULL CHECK (user_kind IN ('human','agent')),
  display_ref    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE sandboxes.memberships (
  tenant_id      TEXT NOT NULL REFERENCES sandboxes.tenants(tenant_id),
  user_id        TEXT NOT NULL REFERENCES sandboxes.users(user_id),
  role           TEXT NOT NULL CHECK (role IN ('owner','operator','viewer','agent')),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE TABLE sandboxes.tenant_provider_credentials (
  tenant_id        TEXT NOT NULL REFERENCES sandboxes.tenants(tenant_id),
  adapter_id       TEXT NOT NULL CHECK (adapter_id IN ('e2b','daytona_cloud')),
  installation_id  TEXT NOT NULL,
  provider_scope_ref TEXT NOT NULL,
  secret_ref       TEXT NOT NULL,               -- Secrets Manager NAME, never the value
  is_shared_pool   BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, adapter_id)
);
CREATE TABLE sandboxes.tenant_provider_quota (
  tenant_id            TEXT NOT NULL REFERENCES sandboxes.tenants(tenant_id),
  adapter_id           TEXT NOT NULL,
  max_concurrent       INTEGER NOT NULL CHECK (max_concurrent >= 0),
  max_monthly_alloc    INTEGER,                 -- NULL = unlimited
  max_monthly_cost_micros BIGINT,               -- provider-cost attribution ceiling
  PRIMARY KEY (tenant_id, adapter_id)
);
```

Altered domain tables — add `tenant_id TEXT NOT NULL REFERENCES sandboxes.tenants(tenant_id)`
(plus a composite index / uniqueness folding tenant_id in where a natural key exists):

- `sandboxes.sandbox_records`  (the allocation — primary tenant anchor; index `(tenant_id,state)`)
- `sandboxes.operations`  (fold into unique key:
  `UNIQUE(tenant_id, actor_principal, operation, resource_id, idempotency_key_sha256)`; add
  `requested_by_user_id TEXT` for attribution)
- `sandboxes.adapter_resources`, `sandboxes.execs`, `sandboxes.exec_frames`,
  `sandboxes.exec_stream_states`
- `sandboxes.checkpoints`, `sandboxes.checkpoint_blobs`,
  `sandboxes.immutable_checkpoint_receipts`, `sandboxes.immutable_git_promotion_receipts`
- `sandboxes.sandbox_events`, `sandboxes.outbox`, `sandboxes.cleanup_requests`,
  `sandboxes.destroy_tombstones`, `sandboxes.safety_fence_observations`,
  `sandboxes.fence_high_watermarks`
- `sandboxes_disposable_task_journal.tasks` (add `tenant_id`; the append-only `events`/`store`
  singleton journal stay global — they are integrity chains, tenant is carried on `tasks`).

Repository enforcement: `SandboxRepositoryTxV1` methods (`repository.ts:150-195`) gain a
`tenantId` scope threaded from the verified context; every `getSandbox`/`listSandboxes`/
`getOperation`/checkpoint/exec read adds `AND tenant_id = $tenantId` (fail-closed). No
unscoped query path is exposed on `/v1`.

**Default-tenant backfill:** deployed prod is a placeholder (plan §D: v0.2.5, real domain
server never shipped) so there are effectively **zero real domain rows** to migrate. Still,
migration is written safely: create `tenants('t_default','default')`, add columns as
`NULL`, `UPDATE ... SET tenant_id='t_default' WHERE tenant_id IS NULL`, then
`ALTER ... SET NOT NULL`. Existing crypto principals are preserved untouched; only the new
account dimension is backfilled. S3: any pre-existing flat objects (none expected) move under
`sandboxes/t_default/`.

### 5. Effort delta + risks

- **Effort delta: M** (net-new against the XL greenfield build, not additive rework). Because
  API/MCP/CLI/SDK don't exist yet, tenancy is 5 new tables + one `tenant_id` column pattern +
  a `tenantId` param on the repo interface + auth-context plumbing at the `/v1` boundary +
  tenant-prefixed S3 keys. No dual-write/backfill of live data (placeholder prod). If it were
  retrofitted after launch it would be L–XL; doing it now is the cheap window.
  - S = the token-verification/context-binding shim if `identities` ships JWKS/introspection ready.
  - L only if BYO-provider (per-tenant Daytona/E2B accounts) is required at launch instead of
    the shared pool — defer; schema already supports it.
- **Risks:**
  1. **Cross-tenant leak via unscoped read** — mitigate by making `tenantId` a required
     argument of every repo read (no default), + a test that asserts a foreign `resource_id`
     returns 404. This is the top fail-closed invariant.
  2. **Principal vs tenant conflation** — `actor_principal` (Infinity capability) must not be
     reused as the tenant boundary; keep them separate columns, both enforced.
  3. **Provider-cost attribution** — provider bills at the shared installation; per-tenant cost
     needs allocation/exec metering tagged by `tenant_id` (feed `tenant_provider_quota`
     ceilings + a usage rollup). Without it, shared-pool cost can't be split. Bake the metering
     hook into the allocate/exec path now.
  4. **Quota enforcement race** — concurrent allocations must check `max_concurrent`
     transactionally (same tx as the sandbox insert) to avoid overshoot.
  5. **identities availability** — token verify must fail-closed if identities/JWKS is
     unreachable; cache JWKS + short-TTL introspection to avoid a hard dependency on every call.
