# open-conversations — Cloud Cutover Runbook

Fleet cutover of the conversations store from per-machine SQLite to the shared
cloud PostgreSQL under **Storage Amendment A1 (PURE REMOTE)**.

> **Scope of this document.** This is the operator runbook for the eventual
> all-machines flip. The current lane (`todos b9b907a9`) delivered **cloud
> readiness only — NO flip.** The schema is live and CRUD-proven on cloud, but
> every machine still runs local SQLite. Do not execute Section 4 until the
> council sequence reaches conversations.

---

## 1. Ordering — conversations flips LAST

Council-approved cutover sequence for the coordination stores:

```
todos  ->  sessions  ->  conversations
```

Conversations **must not flip** until **todos** and **sessions** are fully
remote, stable, and verified. Conversations is the fleet's live agent-to-agent
channel; flipping it early would strand coordination if an earlier store rolls
back. This ordering is fixed by the final plan (`OSS-CLOUD-RUNTIME-FINAL-PLAN`).

---

## 2. Target infrastructure

| Item | Value |
|------|-------|
| Account | `hasna-xyz-infra` (789877399345) |
| Region | `us-east-1` |
| RDS cluster | `hasna-xyz-infra-apps-prod-postgres` (pg16, MultiAZ) |
| Database | `conversations` |
| Publicly accessible | **NO** (private; reach via SSM tunnel today) |
| App runtime role | `conversations_app` (owns the `conversations` DB) |
| App runtime secret | `hasna/xyz/opensource/conversations/prod/rds` |
| Owner/DDL secret | `hasna/xyz/infra/apps/prod/postgres/master` (RDS-managed; see `rds_managed_secret_arn`) |
| Runtime env var | `HASNA_CONVERSATIONS_DATABASE_URL` (fallback: `CONVERSATIONS_DATABASE_URL`) |
| Mode env var | `HASNA_CONVERSATIONS_STORAGE_MODE` (fallback: `CONVERSATIONS_STORAGE_MODE`) |

### Secret naming note (reachability fallback)

The program catalog references an owner secret `hasna/oss/conversations/database-url-owner`.
That name does **not** exist yet. The **reachability fallback rule** applies:
use the reachable secrets that already exist —
- **DDL / schema:** `hasna/xyz/infra/apps/prod/postgres/master` (owner-capable).
- **App runtime DSN:** `hasna/xyz/opensource/conversations/prod/rds` (`conversations_app`).
When the canonical `hasna/oss/...` owner secret is provisioned, repoint DDL to it.

### Access path (replace before flip)

The instance is private. Ops access today is via SSM port-forwarding through
bastion `i-086c334559bec7e0f` (spec lives in the `...prod/rds` secret under
`ssm`, local port `15432`):

```bash
aws ssm start-session --target i-086c334559bec7e0f \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["hasna-xyz-infra-apps-prod-postgres.culaqeaao9n7.us-east-1.rds.amazonaws.com"],"portNumber":["5432"],"localPortNumber":["15432"]}'
```

**Before the fleet flip, the SSM-tunnel access must be replaced by the serve
API path** (per the final plan) so runtime nodes do not depend on bastion
tunnels. Fleet machines reach RDS over Tailscale/VPC networking, not SSM.

---

## 3. A1 compliance — PURE REMOTE, and what must be gated off

**Cloud mode = reads AND writes go directly to cloud Postgres.** No hybrid, no
sync engine, no cache-as-mode, no merge/conflict logic. After a machine flips,
its local `~/.hasna/conversations/*.db` becomes a **dated backup file**, never a
live read/write source.

### Bidirectional-sync surfaces that MUST be disabled at flip

`src/lib/storage-sync.ts` is the LEGACY bidirectional sync engine. It is marked
in-code with `CUTOVER: gate off`. The flip lane MUST disable/remove:

- `StorageMode` value **`"hybrid"`** and its acceptance in `normalizeStorageMode`
  (A1 permits only `local` pre-flip and `remote` post-flip).
- `storageSync()` and the **`storage sync`** CLI subcommand (pull-then-push).
- The `storage push` / `storage pull` subcommands **as a runtime data path**
  (`syncPush`/`pushTable`/`upsertPg`, `syncPull`/`pullTable`/`upsertSqlite`).
- The `_sync_conflicts` machinery: `detectConflicts`, `storeConflicts`,
  `listConflicts`, `detectAndLogConflicts`, `CONFLICT_TABLES`, `SyncConflict`.

**Kept (safe) as ops/migration tooling, not a runtime data path:**
`getStoragePg`, `runStorageMigrations`, `listPgTables`, `PG_MIGRATIONS`, and the
PgAdapterAsync remote adapter — these are how the runtime talks to cloud and how
schema is applied.

> **Current runtime reality.** `src/lib/db.ts` is SQLite-only today; there is no
> `getDb()`-to-Postgres path yet. Standing up that pure-remote runtime (routing
> the app's reads/writes through PgAdapterAsync) is the **flip lane's** job and
> is intentionally NOT done here.

### TLS

The remote adapter (`src/lib/remote-storage.ts`) currently sets
`ssl: { rejectUnauthorized: false }` when the DSN contains `sslmode=require`.
This still connects today but is on `pg`'s deprecated path (pg v9 will treat
`sslmode=require` as `verify-full`). The flip lane should adopt the shared
`@hasna/contracts` storage-kit TLS approach (libpq `sslmode` semantics + the RDS
CA via `PGSSLROOTCERT`/`NODE_EXTRA_CA_CERTS`) so verification is correct against
the real RDS hostname. Note: because prod nodes connect to the real RDS DNS
name, the cert matches — the hostname mismatch only appears when tunneling to
`127.0.0.1` for ops testing (use `uselibpqcompat=true&sslmode=require` for that).

---

## 4. Flip procedure (all machines together, single-writer)

Do **not** do a per-machine staggered flip of a coordination store — a mixed
local/remote fleet splits the agent channel (split-brain). Flip **all machines
together**.

### 4.0 Preconditions
- [ ] `todos` and `sessions` are fully remote, stable, and verified.
- [ ] Schema on cloud is current (Section 5 confirms it is applied).
- [ ] Readiness CRUD proof green on the app runtime role (Section 6).
- [ ] SSM-tunnel access replaced by the serve/VPC path for runtime nodes.
- [ ] Announce a short coordination-store freeze window in `#oss-cloud-runtime`.

### 4.1 Final drain (optional, one-time backfill)
If any machine holds local-only channel/project rows that must survive, run a
**one-time** `conversations storage push` from each machine to seed cloud, then
verify counts. This is a migration step, not the runtime mode — after it, sync
is never run again.

### 4.2 Flip
On every machine, atomically:
1. Set `HASNA_CONVERSATIONS_DATABASE_URL` from `hasna/xyz/opensource/conversations/prod/rds` (never printed to logs).
2. Set `HASNA_CONVERSATIONS_STORAGE_MODE=remote`.
3. Restart the conversations MCP/CLI runtime.

### 4.3 Retire local SQLite
Rename the local DB to a dated backup so nothing reads it:
`~/.hasna/conversations/conversations.db` -> `conversations.db.pre-cutover-YYYYMMDD.bak`.

### 4.4 Verify
- [ ] `conversations storage status --json` reports `mode: remote`, `configured: true`.
- [ ] A canary message sent from machine A is read on machine B within seconds.
- [ ] No process is opening the retired local `.db`.
- [ ] Error logs clean; RDS connection count sane.

---

## 5. Schema state (already applied)

The full schema (`PG_MIGRATIONS` in `src/lib/pg-migrations.ts`) is applied to the
cloud `conversations` DB. Tables present: `projects, channels, channel_members,
channel_subscriptions, messages, agent_presence, resource_locks, reactions,
message_read_receipts, channel_notification_reads, message_mentions, feedback,
graph_edges, tasks, task_comments, task_activity, task_dependencies, _migrations`.

Re-apply idempotently (owner secret) with:
```
bunx open-conversations storage migrate     # runs PG_MIGRATIONS (IF NOT EXISTS)
```

### High-volume `messages` indexes

Migration 2 adds two hot-path indexes on the write-heaviest table:
- `idx_messages_channel_created (channel, created_at, id)` — channel history read + pagination (`WHERE channel = ? ORDER BY created_at, id`).
- `idx_messages_to_agent_unread (to_agent) WHERE read_at IS NULL` — partial index for the unread-inbox fan-in (`WHERE to_agent = ? AND read_at IS NULL`).

Both are live on cloud. Existing single-column indexes (`session, to, created,
channel, pinned, blocking, reply_to, project`) and the GIN FTS index
(`search_vector`) remain.

---

## 6. Readiness proof (how it was verified)

A scripted CRUD cycle was run through the repo's **remote storage code path**
(`PgAdapterAsync`) using the **app runtime role** `conversations_app` — NOT
local SQLite:

1. `INSERT` scratch channel
2. `INSERT` message into it (verified the `search_vector` trigger fired)
3. `SELECT` it back and assert content
4. `DELETE` message + channel; confirm both gone

Result: **PASS** — pure-remote reads and writes work under the least-privilege
app role. Rerun (via SSM tunnel) by pointing `READINESS_DSN` at
`postgres://conversations_app:***@127.0.0.1:15432/conversations?uselibpqcompat=true&sslmode=require`
and executing a CRUD script against `src/lib/remote-storage.ts`.

---

## 7. Rollback

Because conversations flips **last** and **all-at-once**, rollback is symmetric:
1. Set `HASNA_CONVERSATIONS_STORAGE_MODE=local` on all machines, unset the DSN.
2. Restore each machine's `conversations.db.pre-cutover-*.bak` -> `conversations.db`.
3. Restart runtimes.

Cloud rows written during the remote window are **not** merged back (A1 forbids
sync). Treat the freeze window as short and low-traffic to minimize divergence,
and prefer fixing forward over rolling back once verified.
