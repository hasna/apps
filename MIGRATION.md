# iapp-projects — migration plan (public `hasna/projects` → private `hasnaxyz/iapp-projects`)

Investigation + local staging only. No repos created/transferred, nothing made private, no npm
publish, no AWS mutation, no code deleted. Read-only AWS + local clone + this report only.

## 0. Snapshot

- **Source**: `hasna/projects` (public), cloned to
  `/home/hasna/workspace/hasnaxyz/internalapp/iapp-projects`.
- **Clone HEAD**: `c9e5af41964ebef33b6ac99925fcb035f0d54214`
  (`Merge pull request #24 from hasna/release/projects-0.1.83-hardening`).
- **package.json**: `@hasna/projects` @ **0.1.84**, `publishConfig.access=public`, no `private`.
- **Version drift to reconcile**: repo main = 0.1.84, git tag `npm/projects/v0.1.89` exists,
  **live server reports 0.1.88**. Main is behind published/deployed. MAJOR bump target is 1.0.0.
- **Total code**: ~39.3k LOC TS (incl tests). Non-test by area: lib 15,245 · cli 4,659 ·
  db 3,795 · mcp 2,697 · serve 1,467 · generated(storage-kit) 736 · types 501 · http 487 ·
  sdk 324 · root src (index/storage/project-store/project-dashboard) ~592.

## A. Surfaces — all four PRESENT; API coverage is the real gap

| Surface | Present | Entry (bin/export) | State |
|---|---|---|---|
| API | **Y** | `bin projects-serve` → `dist/serve/index.js`; handler `src/serve/app.ts`; entry `src/serve/index.ts` | LIVE self-hosted, pure-remote (Bun.serve, `@hasna/contracts/auth` key auth). Public `/health` `/ready` `/version` `/openapi.json` `/`; authed `/v1/*` with `projects:read`/`projects:write` scopes. |
| CLI | **Y** | `bin projects` → `dist/cli/index.js`; `src/cli/index.ts` (+ commands/, 88 subcommands in `workspaces.ts` alone) | Dual-mode: mostly LOCAL SQLite; only 9 call-sites route to cloud via `resolveProjectsBackend()`. |
| SDK | **Y** | `exports "./sdk"` → `src/sdk/index.ts`; generated typed client `src/sdk/client.ts` (`bun run sdk:generate` from OpenAPI) | Clean thin `/v1` client, `PROJECTS_API_URL`+`PROJECTS_API_KEY`, "never a DSN". Good reference for the target. |
| MCP | **Y** | `bin projects-mcp` → `dist/mcp/index.js`; `src/mcp/index.ts`, HTTP transport `src/mcp/http.ts` | HTTP mode on `127.0.0.1:8871` (`--http`/`MCP_HTTP=1`) per fleet HTTP-not-stdio policy. Imports mostly LOCAL SQLite modules; partial cloud. |

**Critical gap — API covers only ~1/3 of the data model.** `src/serve/pg-store.ts` (Postgres,
the only cloud store) exposes exactly **5 resource families**: `roots`, `agents`, `recipes`,
`workspaces` (=projects), `workspace_events`. The CLI/MCP additionally read/write, **local-SQLite
only, with NO `/v1` endpoint**: `project_budgets` + `project_budget_spend` (budget.ts 536),
`agent_runs`, `tmux_profiles`/`tmux_profile_windows`/`workspace_tmux_sessions`,
`workspace_locations`, `workspace_agents`, `workspace_locks`, `workspace_migration_map`,
plus a whole second local store (`src/db/project-store.ts` 1,042 LOC: project canvases, data
models, data records, loop links) and local-only feature libs (dashboard, reports, render,
canvas, eval-artifacts, agent-assist, channel). So "single data path = /v1" requires **either
expanding the API to these domains or cutting those features** — this is the migration's core work.

**Machine-local execution (not data, cannot become a `/v1` call)**: tmux control (`lib/tmux.ts`
530), project launch (`lib/project-start.ts` 508), git clone/import (`lib/workspace-import.ts`,
`lib/workspace-github.ts` 663), path/session resolution (`lib/project-resolver.ts`,
`lib/project-tmux-status.ts`), doctor, and the AI-SDK agent loop (`lib/workspace-agent.ts` 2,480 +
`workspace-agent-eval.ts` 873). These stay as **local logic that must source/persist registry
state through the `/v1` client**, not through SQLite. Single-mode = single *data* path; local
*execution* wrappers are allowed and expected.

## B. Single-mode removal scope (remove ALL local/SQLite/dual-mode/backcompat/DSN)

**Delete outright (local SQLite + client-side DSN + sync engine — FORBIDDEN patterns):**
- `src/db/database.ts` (76) — `bun:sqlite` `getDatabase()` opener.
- `src/db/schema.ts` (318) — SQLite migrations.
- `src/db/workspaces.ts` (1,527) — SQLite registry CRUD (the local twin of pg-store).
- `src/db/project-store.ts` (1,042) — second SQLite store (canvases/data-models/loops).
- `src/db/storage-sync.ts` (542) — local↔cloud **sync engine** + `STORAGE_MODE`/`DATABASE_URL`
  resolution (`getStoragePg`, `getStorageDatabaseUrl`, `storagePull/Push/Sync`). Pure-remote = none.
- `src/db/remote-storage.ts` (50) — **`PgAdapterAsync`: client-side `pg.Pool` from a DSN. This is
  the explicitly-FORBIDDEN DSN-on-client path. Must go.**
- `src/storage.ts` (45) — re-exports `CANONICAL_PROJECTS_RDS_*`, `getStorageDatabaseUrl`,
  `getStoragePg`, `PgAdapterAsync`. Leaks RDS/DSN to clients. Remove or replace `./storage` export.
- Matching `*.test.ts` for the above (database/project-store/workspaces/storage-sync/remote-storage).
- **Removal here ≈ 3,600 LOC src + ~2–3k LOC tests.**

**Keep but RELOCATE to server-only:**
- `src/db/pg-migrations.ts` (240) — Postgres migration source (`PG_MIGRATIONS`, feeds
  `migrations/0001_baseline.sql` and `src/serve/migrations.ts`). Move to `src/serve/`.
- `src/generated/storage-kit/*` (736) — vendored Postgres pool/query kit; legitimately used by
  the **server** (`serve/index.ts createPgPool`). Keep as server-only. Its `mode.ts` local|cloud
  dual-mode logic is unused once clients are thin — can be pruned to the pool/query/tls it needs.

**Consolidate the client transport:**
- `src/http/client.ts` (379) + `src/http/backend.ts` (108) already implement the correct
  `/v1` bearer client + the `local|cloud` toggle. In single-mode drop the `local` branch: the
  client is ALWAYS `cloud-http`. Best: **fold this into the SDK** (`src/sdk/client.ts`) so there
  is exactly one typed `/v1` client used by CLI, MCP, and external consumers. Hard-fail when
  `HASNA_PROJECTS_API_KEY` (or `PROJECTS_API_KEY`) is missing — no silent local fallback.

**Rewire (bun:sqlite today → `/v1` client, or cut):** 16 `lib/*` files import `bun:sqlite`:
budget, project-agent-assist, project-channel, project-dashboard, project-eval-artifacts,
project-reports-server, project-resolver, project-start, project-store, project-tmux-status,
workspace-defaults, workspace-doctor, workspace-github, workspace-import, workspace-plan,
workspace-runtime. Each must be triaged: data-persistence libs (budget, dashboard data, canvas,
eval, channel, project-store, management) → back with a `/v1` endpoint + SDK call OR **drop the
feature**; execution libs (tmux/start/import/github/runtime/resolver/doctor) → keep, swap their
SQLite reads/writes for SDK calls.

**Root exports to gut:** `src/index.ts` (493) currently `export *` s `getDatabase`,
`storage-sync`, `remote-storage`, `pg-migrations`, and the local project-store — strip to the
domain types + the SDK client. Drop `./storage`, `./project-store`, `./dashboard` subpath exports
that expose local stores; keep `./sdk` and `./serve`.

**Recommendation on scope (fix-forward, ship the 4 surfaces):** two viable shapes —
- **Full parity (XL):** extend `pg-store.ts` + `/v1` + OpenAPI to every domain (budgets/spend,
  agent_runs, tmux profiles, locations, canvases, data-models, loops, channels), regenerate SDK,
  rewire all 88 CLI cmds + MCP tools. Weeks of work.
- **MVP single-mode (recommended, L):** ship `/v1` over the domains that carry the CLI verbs the
  fleet actually uses — projects/roots/recipes/agents/events (exist) **+ budgets/spend + agent_runs**
  (add). Keep tmux/git/start/import/doctor as local execution over the `/v1` client. **Defer or
  drop** the heavy local-only visualization/AI extras (dashboard-server 1,429, reports-server 773,
  render 1,411, canvas-blocks 331, agent-assist 883, eval 873+135, second project-store 1,042 ≈
  6,900 LOC) — they don't fit the thin-client model and aren't the `projects` registry core. This
  is what makes "4 fully-working surfaces, single data path" achievable in one push.

## C. package.json edits

- `name`: `@hasna/projects` → **`@hasnaxyz/projects`**.
- add `"private": true` (repo safety) **and** `"publishConfig": { "access": "restricted",
  "registry": "https://registry.npmjs.org" }` (was `access:"public"`).
- `version`: 0.1.84 → **1.0.0** (MAJOR; reconcile with live 0.1.88 / npm 0.1.89 — 1.0.0 clears it).
- `repository`/`homepage`/`bugs`: `github.com/hasna/projects` → `github.com/hasnaxyz/iapp-projects`.
- `bin`: keep `projects` + `projects-mcp`; **`projects-serve` stays** (it's the deployed API).
- `exports`: keep `.`, `./sdk`, `./serve`; **drop `./storage`, `./project-store`, `./dashboard`**
  (local-store subpaths). `.` should re-export the SDK client + domain types only.
- `scripts.build`: drop the `src/storage.ts src/project-store.ts src/project-dashboard.ts`
  bundling and the SQLite deps; keep cli/mcp/serve/sdk/index builds. Keep `sdk:generate`,
  typecheck, `prepublishOnly` (typecheck + test).
- `dependencies` to **drop**: none of these are pure-remote client deps — `pg` stays (server only;
  keep it externalized in cli/mcp bundles so the CLI never pulls a pg driver). Re-audit
  `@openrouter/ai-sdk-provider` + `ai` — only needed if the AI agent loop (`workspace-agent.ts`)
  ships; if that feature is deferred, drop both (~large dep cut) from the CLI bundle.
- `postinstall` `mkdir -p $HOME/.hasna/projects`: **remove** (no local dir in single-mode).
- `author` email `andrei@hasna.com`, `license` Apache-2.0: keep or switch to `UNLICENSED` for a
  private internal app (recommend `UNLICENSED` + drop the OSS LICENSE/CODE_OF_CONDUCT/CONTRIBUTING
  from `files`).

## D. AWS / deploy state — LIVE and HEALTHY (previously a "blocked root", now resolved)

Verified read-only as account **789877399345** (`hasna-xyz-infra`), us-east-1:
- **Live HTTP**: `https://projects.hasna.xyz/health` → `{"status":"ok","version":"0.1.88","mode":"cloud"}`;
  `/ready` → `ready`; `/version` → 0.1.88; `/v1/health` correctly rejects missing key
  (`reason:"missing_token"`). Key-auth `/v1` is enforced.
- **ECS**: cluster `oss-fleet-prod`, service **`projects-prod`** ACTIVE, desired 1 / running 1 /
  pending 0, task-def `projects-prod:5`, rollout **COMPLETED**, "reached a steady state".
- **ALB**: `oss-fleet-alb` 443 listener rule **priority 7724** host `projects.hasna.xyz` →
  target group `projec20260706133359425400000001` (container `projects:8080`), **1 target healthy**.
  No stopped-task failures observed. The old task-def/routing blocker is cleared.
- **RDS**: two instances available — `hasna-xyz-infra-apps-prod-postgres` (the shared OSS RDS this
  app currently uses) and `internalapps-prod-postgres` (dedicated internal-apps RDS). **Decision:**
  task says keep shared `hasna-xyz-infra-apps-prod-postgres`; option exists to move the projects DB
  onto `internalapps-prod-postgres` to match the iapp cohort — coordinate before choosing.
- **S3**: `hasna-xyz-opensource-projects-prod` exists (OSS-named). **needs_S3 = NO** for the 4
  surfaces — pg-store is Postgres-only; S3 is only for the optional workspace `s3_bucket`/
  cloud-storage-readiness feature. If kept, rename toward `hasna-internalapps-projects-prod-789877399345`.
- **Secrets (names only)**: `hasna/oss/projects/database-url`, `.../api-key-signing-secret`,
  `.../api-key`, plus `hasna/xyz/opensource/projects/prod/{rds,s3,aws,env}` and legacy
  `hasna/open-projects/*`. All required server secrets (DB URL, HMAC signing key, an issued key)
  are provisioned. For the iapp cutover, mirror to `hasna/internalapps/projects/*` if the cohort
  standard requires it; server envs already read `HASNA_PROJECTS_DATABASE_URL` /
  `HASNA_PROJECTS_API_SIGNING_KEY` (with fallbacks).
- **Deploy pipeline**: `.github/workflows/deploy.yml`, `APP=projects`, OIDC role
  `projects-prod-gha-deploy`, GitHub env `production`, native arm64 build → ECR → one-shot migrate
  task → ECS rolling deploy w/ circuit-breaker assert. On repo move the OIDC trust is pinned to
  `repo:hasna/projects:environment:production` and **must be re-pinned to
  `repo:hasnaxyz/iapp-projects:...`** (Terraform `deploy-oidc-role`), plus SSM manifest
  `/hasna/deploy/projects` re-owned (not readable with the current role — verify at cutover).

## E. Ordered migration checklist

1. **Reconcile version drift**: confirm what deployed 0.1.88 / tagged 0.1.89; fast-forward main or
   note the delta. Target release = **1.0.0**.
2. **Pick scope** (recommend MVP single-mode, section B) and **choose RDS** (shared vs internalapps).
3. **Server: extend `/v1`** to the domains the retained CLI verbs need (add budgets/spend +
   agent_runs to `pg-store.ts`, `app.ts` routes, `openapi.ts`, PG migration in `pg-migrations.ts` /
   new `migrations/000x.sql`). Keep auth scopes.
4. **Regenerate SDK** (`bun run sdk:generate`) so the typed client covers the new endpoints; make
   the SDK the single `/v1` client.
5. **Rewire CLI + MCP to the SDK only**: remove every `db/*` (SQLite) import; every registry read/
   write goes through the client. Delete the `local` transport branch (`http/client.ts` /
   `backend.ts`) — hard-fail without an API key. Keep tmux/git/start/import as local execution over
   the client.
6. **Delete** the SQLite + DSN + sync files (section B) and their tests; relocate `pg-migrations.ts`
   to `src/serve/`; strip `src/index.ts`/`storage.ts` DSN/SQLite exports.
7. **package.json** edits (section C); `bun install`; `bun run typecheck`; `bun test`; `bun run build`.
8. **Adversarial review #1** (independent): grep-prove zero `bun:sqlite`, zero client `pg.Pool`,
   zero `STORAGE_MODE`/`DATABASE_URL` on the client path; confirm CLI hard-fails without a key and
   every command hits `/v1`.
9. **GitHub move**: create private `hasnaxyz/iapp-projects`, push, transfer/repoint. Re-pin OIDC
   deploy role trust to the new repo; move SSM deploy manifest; keep `oss-fleet-prod`/ALB/RDS.
10. **Deploy 1.0.0** via the pipeline (build → migrate → ECS rolling, circuit-breaker). Verify
    `/health` reports `1.0.0`, `/ready` ok, target healthy, and a keyed `/v1/projects` round-trips.
11. **npm rename**: publish `@hasnaxyz/projects@1.0.0` `access=restricted` (post publish-intent to
    git-publishing first). Do **not** touch public `@hasna/projects` (deprecated later, separately).
12. **Cutover + rollback**: fleet installs `@hasnaxyz/projects`, sets `HASNA_PROJECTS_API_URL`+
    `HASNA_PROJECTS_API_KEY`; **rollback = keep old `@hasna/projects` local build available / unset
    the envs**. Because single-mode has no local fallback, back up any local `~/.hasna/projects`
    SQLite and import its rows into cloud Postgres via `/v1` before decommissioning per-machine data.
13. **Adversarial review #2** + **final live cross-machine verification**: write from machine A via
    `/v1`, read from machine B — same shared state.

## F. Blockers + size

- **Size: L (XL if full feature parity required).** ~3.6k LOC hard-delete + ~16 lib files rewired +
  new API endpoints + SDK regen + 88-command CLI rewrite. Biggest of the iapp migrations because
  the API today covers only 5 of ~15 data domains and much of the app is machine-local execution.
- **Blocker 1 — API coverage gap**: budgets/spend, agent_runs, canvases/data-models, tmux, locations
  have no `/v1`. Must build endpoints or cut the features (drives the L-vs-XL fork). Buildable.
- **Blocker 2 — machine-local execution**: tmux/git/start/AI-loop cannot be `/v1` calls; must be
  re-expressed as local execution over the cloud client without reintroducing a local *data* store.
  Design decision, not a hard blocker.
- **Blocker 3 — forbidden DSN path present** (`db/remote-storage.ts PgAdapterAsync`,
  `storage.ts` RDS/DSN exports): must be fully removed; verify nothing else imports it.
- **Blocker 4 — version drift** (main 0.1.84 vs live 0.1.88 vs npm 0.1.89): reconcile before 1.0.0.
- **Blocker 5 — infra re-pinning**: OIDC deploy role trust + SSM `/hasna/deploy/projects` are tied
  to `hasna/projects`; must move to `hasnaxyz/iapp-projects` (Terraform) or deploys break.
- **Non-blockers**: server is already live/healthy/pure-remote; SDK is already a clean `/v1` client;
  MCP already HTTP; secrets + RDS + ALB + ECS all provisioned.

Report path: `/home/hasna/.hasna/projects/workspaces/wks_i9l0cc7zxox7/reports/iapp-migration/iapp-projects.md`

## Users & Tenants (multi-tenancy design)

Investigation-only addendum. No code/AWS mutation; extends sections A–F above.

### G.1 Existing owner/agent/org notions (what's there today — cited)

There is **NO tenant / organization / account concept anywhere** in the schema or code
(grep for `tenant|organization|account_id|owner_id`: 0 real hits — only GitHub-org config).
The current model is effectively a **single global tenant**. The closest existing notions:

- **`agents`** (`migrations/0001_baseline.sql:42-54`): `id, slug, kind CHECK(human|ai|service|cli),
  provider, model, role, permissions[], metadata`. This is the nearest thing to a "user," but it
  is **registry data** (who can work in a workspace), NOT an auth principal — nothing binds an API
  key to an agent row.
- **`workspace_agents`** (`:104-113`): `workspace_id, agent_id, role, assigned_by`,
  `UNIQUE(workspace_id, agent_id, role)` — a membership-like join, but scoped to a *workspace*, not
  a tenant/org.
- **`roots.github_org` / `roots.repo_visibility`** (`:13-16`) and `workspaces.git_remote` — GitHub
  org/owner config for repo creation. **Not** a tenancy boundary.
- **Domain tables that belong to "a customer"**: `workspaces` (=projects, `:68-88`), `roots`
  (`:6-24`), `recipes`, `tmux_profiles`, `agent_runs`, `project_budgets`/`project_budget_spend`
  (`:146-175`) — all currently global, no ownership column.
- **Auth (`src/serve/app.ts:60-109`, `@hasna/contracts/auth`)**: `ApiKeyClaims = {v, kid, app,
  scopes[], iat, exp, agent?}` — `agent` is an *optional informational* subject; **no tenant claim**.
  `AuthDecision.principal = {kid, app, scopes, agent, claims}`. **`app.ts` currently ignores the
  principal entirely** — it only checks `decision.ok`, then every `pg-store` query runs unscoped
  (`SELECT * FROM roots`, etc.). The contracts `ApiKeyRecord` (api_keys table) also has **no
  tenant_id**. So today: one key = full global access.

### G.2 Tenant model + isolation

- **Tenant = the signup account** (from the central `identities` IdP). One `tenants` row per account.
  All registry state — roots, workspaces(projects), recipes, tmux_profiles, agents, agent_runs,
  budgets/spend, events, locations, locks — **belongs to exactly one tenant**.
- **Isolation = shared DB + `tenant_id` FK on every domain row + fail-closed scoping** (matches the
  cohort standard; the existing shared `hasna-xyz-infra-apps-prod-postgres` stays). Enforcement is
  **defense-in-depth, two layers**:
  1. **Application layer** — every `pg-store` method takes `tenantId` (from the principal) and every
     statement gets `WHERE tenant_id = $N` (SELECT/UPDATE/DELETE) or a `tenant_id` column (INSERT).
     Route through one private helper so no query can omit it.
  2. **Postgres RLS backstop** — `ALTER TABLE … ENABLE ROW LEVEL SECURITY` + policy
     `USING (tenant_id = current_setting('app.tenant_id')::text)`; the request handler issues
     `SET LOCAL app.tenant_id = $tenant` per transaction on the pooled connection. If app code ever
     forgets a WHERE, RLS still denies — **fail-closed**, not fail-open.
- **Per-tenant uniqueness**: today `slug` (roots/recipes/agents/tmux_profiles/workspaces) and
  `workspaces.primary_path` are **global `UNIQUE`** (`:8,28,44,58,70,77`). These must become
  **composite** `UNIQUE(tenant_id, slug)` / `UNIQUE(tenant_id, primary_path)`; `ensureUniqueSlug()`
  (`pg-store.ts:174`) must add `AND tenant_id = $`. Child uniques (`workspace_locations`,
  `workspace_agents`, `tmux_profile_windows`, `workspace_tmux_sessions`) already carry a parent id so
  stay correct; add `tenant_id` for direct scoping/RLS anyway.

### G.3 User model (human + agent) + memberships

Users are **auth principals sourced from the central `identities` IdP** — kept distinct from the
existing registry `agents` table (registry `agents` may optionally carry `user_id` to link a working
identity to its principal).

- **`users`** — global principal (an identities subject can join >1 tenant): `id, external_id`
  (identities subject/kid-owner), `kind CHECK(human|agent|service)`, `handle, email, display_name,
  status, metadata, created_at, updated_at`.
- **`memberships`** — binds a user into a tenant with a role: `id, tenant_id FK, user_id FK,
  role CHECK(owner|admin|member|viewer|agent), status, created_at`, `UNIQUE(tenant_id, user_id)`.
  Tenant membership + role is the authority check; scopes (`projects:read/write`) remain the
  coarse action gate.

### G.4 Auth binding: key/session → (tenant_id, user_id, scopes)

The contracts token stays as-is (HMAC-signed `app+scopes+kid+agent`; **do not fork contracts to add a
tenant claim**). Bind tenant/user **server-side by `kid`**:

- **`api_key_context`** sidecar (projects DB, provisioned by `identities` at key issuance):
  `kid PK, tenant_id FK, user_id FK, scopes[], created_at`. (Alternatively add `tenant_id,user_id`
  columns to the contracts `api_keys` table projects already owns via `apiKeyMigrations()` — sidecar
  is cleaner, avoids patching vendored migrations.)
- **Flow in `app.ts`**: after `verifier.authenticate()` succeeds, read `decision.principal.kid`,
  look it up in `api_key_context` → `(tenant_id, user_id)`; `SET LOCAL app.tenant_id`; pass
  `{tenantId, userId}` into every store call. **Every `/v1` query is tenant-scoped; no unscoped path.**
- **Fail-closed on unrecorded keys**: switch the verifier from the lenient `isRevoked` hook to the
  strict **`store.statusChecker()`** (contracts `ApiKeyStore`) — a cryptographically-valid key with
  **no binding row cannot authenticate** (no binding ⇒ no tenant ⇒ deny). This is the single most
  important change: without it a signed-but-unbound key would fall through to a null tenant.

### G.5 Concrete schema changes

**New tables (3):** `tenants`, `users`, `memberships`, plus the `api_key_context` binding table (4th,
auth-adjacent). 

**Add `tenant_id TEXT NOT NULL REFERENCES tenants(id)` to all 15 existing domain tables:**
roots · recipes · agents · tmux_profiles · workspaces · workspace_locations · workspace_agents ·
workspace_events · agent_runs · project_budgets · project_budget_spend · tmux_profile_windows ·
workspace_tmux_sessions · workspace_locks · workspace_migration_map. Add
`CREATE INDEX … (tenant_id)` on each; convert global uniques to composite (G.2); enable RLS on each.

**If the deferred local-only `project-store` domains are promoted to `/v1`** (section A —
`project_canvases, project_data_models, project_data_records, project_loop_links`), each also needs
`tenant_id` (→ **19 tables total**). Not required for the MVP-single-mode scope.

**Migration + backfill (additive, single new migration `000x_tenants.sql`):**
1. Create `tenants, users, memberships, api_key_context`.
2. Insert one **default tenant** (`tnt_default`, slug `hasna`) + a system `users` row + owner
   `memberships` row.
3. `ALTER TABLE … ADD COLUMN tenant_id` (nullable) → `UPDATE … SET tenant_id='tnt_default'` →
   `ALTER … SET NOT NULL` + add FK/index; swap uniques to composite; enable RLS.
4. Backfill `api_key_context` for every existing issued `kid` → `tnt_default` + system user.

### G.6 Machine-local bits (tmux / git / AI-loop) and tenant/user context

The machine-local execution wrappers (`lib/tmux.ts`, `lib/project-start.ts`, `workspace-import`,
`workspace-github`, `workspace-agent` loop — section A) **do not and cannot go through `/v1`** for the
act of spawning processes/cloning repos. They acquire tenant/user context implicitly: the same
`HASNA_PROJECTS_API_KEY` they use for registry I/O resolves to `(tenant_id, user_id)` server-side, so
**any state they persist** (workspace_locations, workspace_tmux_sessions, workspace_locks, events,
agent_runs, spend) is written **through the `/v1` client and auto-scoped by the key** — the client
never needs to know its own tenant. Purely ephemeral on-box state (live tmux panes, working-copy
paths) stays machine-local and is associated with the tenant *transitively* via the workspace row it
belongs to; stamp `machine_id` + acting `user_id` into the location/event metadata for attribution.
No local *data* store is reintroduced — consistent with the single-data-path rule.

### G.7 Effort delta + risks

**Delta on top of the section-F migration: M** (additive + mechanical, but broad):
- Schema/migration (new tables, tenant_id×15, composite uniques, RLS, backfill): **M**.
- `pg-store.ts` rewrite — thread `tenantId` through ~every method + every SQL clause (586 LOC): **M–L**.
- `app.ts` — principal → `api_key_context` lookup → `SET LOCAL` → pass context: **S**.
- Auth — sidecar binding table, switch to strict `statusChecker()`, identities provisioning hook: **M**.
- CLI/SDK — mostly transparent (tenant rides the key); add `tenant`/`user`/`membership` admin verbs: **S–M**.

**Risks:**
- **Cross-tenant leak (fail-open)** if any query omits `WHERE tenant_id` — mitigated by the single
  scoping helper **and** the RLS backstop; add an adversarial test that asserts tenant B cannot read
  tenant A's rows.
- **Unbound valid key** authenticating with a null tenant — mitigated by strict `statusChecker()`
  (G.4); highest-priority correctness item.
- **Connection pooling vs RLS** — must use `SET LOCAL` inside a per-request transaction, never a
  session-wide `SET`, or a pooled connection leaks one tenant's setting to the next request.
- **Uniqueness migration** — dropping global `UNIQUE(slug)`/`primary_path` for composite; safe
  because existing data is one tenant (**low backfill risk** — no dup conflicts possible pre-split).
- **identities coupling** — key issuance must populate `api_key_context`; if identities is not ready,
  provide a projects-side admin path to mint+bind so the app is not blocked.

**Backfill risk: LOW** — single pre-existing logical tenant, additive nullable→backfill→NOT NULL, no
cross-tenant collisions possible before the split; fully reversible (drop columns/tables, restore
global uniques).
