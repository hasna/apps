# Shared Cloud Task Store — Cutover Runbook

This runbook covers the migration of `@hasna/todos` from disjoint per-machine
local SQLite stores to a single shared Postgres task store, using the sanctioned
two-phase plan:

1. **Dual-write shadow** (pre-cutover, reversible at any time): local SQLite
   stays the sole source of truth for reads **and** writes; every successful
   local write is mirrored asynchronously to the cloud Postgres sync tables.
   Nothing is ever read from the cloud during this phase.
2. **Single-writer flip** (Amendment A1, pure remote): all machines switch to
   reading and writing directly against the shared Postgres store in one
   coordinated window. Local SQLite becomes a dated backup file.

The council rejected per-machine cloud flips because they create a split-brain
across disjoint stores. Machines therefore flip **together**, never one at a
time.

## Terminology and knobs

| Env var | Meaning |
| --- | --- |
| `HASNA_TODOS_STORAGE_MODE` | `local` (default) \| `remote` \| `hybrid` |
| `HASNA_TODOS_SHADOW` | `1` enables the dual-write shadow mirror (requires `MODE=local` + a DSN) |
| `HASNA_TODOS_DATABASE_URL` | Postgres DSN for the shared store (from Secrets Manager) |
| `HASNA_TODOS_DATABASE_SSL` | boolean, defaults to `true` |

Local-development fallbacks without the `HASNA_` prefix are accepted
(`TODOS_SHADOW`, `TODOS_DATABASE_URL`, ...).

## Canonical infrastructure

- Cluster/database: `hasna-xyz-infra-apps-prod-postgres` / `todos`
  (account `789877399345`, region `us-east-1`).
- Runtime DSN secret (name only): `hasna/xyz/opensource/todos/prod/rds`.
- The instance is **not** publicly accessible. Reach it from outside the VPC
  only through the SSM port-forward bastion documented in the secret's `ssm`
  block (`AWS-StartPortForwardingSessionToRemoteHost`).

### Opening the sanctioned tunnel (reachability fallback)

```
aws ssm start-session \
  --target <ssm.target_instance_id> \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["<rds host>"],"portNumber":["5432"],"localPortNumber":["15432"]}'
```

Then point tooling at `127.0.0.1:15432` with `sslmode=require`. Never paste the
password on a command line; pull the DSN from Secrets Manager and pipe it
directly into `psql` / the app.

## Schema

The shared store uses the repo-native sync schema
(`postgresTodosSyncSchemaSql()` in `./storage`): `todos_sync_records`
(keyed by `service, object_type, object_id`) plus `todos_sync_cursors`. Apply
it idempotently before any mirror or cutover:

```
bun -e "const m=await import('./src/storage/postgres-sync.ts'); \
  console.log(m.postgresTodosSyncSchemaSql().join(';\n')+';');" > /tmp/todos-schema.sql
psql "$DSN" -v ON_ERROR_STOP=1 -f /tmp/todos-schema.sql
```

All statements use `IF NOT EXISTS`, so re-running is safe.

---

## Phase 1 — Dual-write shadow (already implemented)

Shadow mode wraps the local adapter so successful writes are mirrored
fire-and-forget to the cloud with bounded retries and a divergence counter. It
never reads from the cloud. Enable it per machine:

```
HASNA_TODOS_STORAGE_MODE=local
HASNA_TODOS_SHADOW=1
HASNA_TODOS_DATABASE_URL=<DSN from hasna/xyz/opensource/todos/prod/rds>
```

Watch divergence with the read-only diagnostic (this command **does** open a DB
connection, unlike `todos storage status`):

```
todos storage shadow-status            # human-readable
todos storage shadow-status --json     # machine-readable
```

`shadow-status` reports per-object-type local vs cloud row counts, cloud
tombstones, `in_sync`, and last mirror lag.

> **Runtime-wiring caveat.** The mirror lives in the storage adapter
> (`createShadowTodosStorageAdapter`). The current CLI/MCP write path still calls
> the `db/*` helpers directly, so `HASNA_TODOS_SHADOW=1` only mirrors writes that
> flow through the storage adapter. Routing the CLI/MCP/server write path through
> the adapter is the prerequisite readiness task before the shadow becomes a full
> live mirror of every machine write, and before Phase 2 is meaningful.

---

## Phase 2 — Single-writer flip (all machines together, Amendment A1)

Perform this as one coordinated operation across every fleet machine.

### Preconditions

- Shadow has been running long enough that `shadow-status` shows small, stable,
  and shrinking `diff` values on every machine.
- The CLI/MCP/server write path routes through the storage adapter (see caveat).
- A maintenance/freeze window is scheduled and announced.

### Steps

1. **Freeze writes.** Stop all agents, loops, routers, and MCP servers that write
   todos on every machine. Confirm no `todos` writers remain.
2. **Final mirror + drain.** Let each machine's mirror queue drain
   (`shadow-status` → `pending: 0`, `divergence: 0`). For any residual
   divergence, run a one-shot reconcile from that machine's local SQLite into the
   cloud snapshot tables (adapter snapshot push) until counts match.
3. **Verify counts.** On each machine, `todos storage shadow-status --json` and
   confirm `diff == 0` for `tasks`, `projects`, `plans`, `agents`, `task_lists`,
   and `templates`. Reconcile any machine that is behind before proceeding.
   The cloud is the union of all machines; local subsets may be smaller, so
   verify that every local row exists in the cloud, not strict equality.
4. **Flip env on ALL machines via config-sync.** In one push, set on every
   machine:

   ```
   HASNA_TODOS_STORAGE_MODE=remote
   HASNA_TODOS_DATABASE_URL=<DSN>
   # remove HASNA_TODOS_SHADOW (shadow is only valid in local mode)
   ```

   Use the fleet config-sync mechanism so the change lands atomically rather than
   machine-by-machine.
5. **Back up local SQLite.** Rename each machine's local DB to a dated backup
   (e.g. `todos.sqlite.pre-cutover-YYYYMMDD`). Do not delete it.
6. **Unfreeze.** Restart writers. All machines now read and write the shared
   store; `todos storage status` shows `Mode: remote`, `Remote: enabled`.
7. **Validate co-drain.** Confirm two machines can claim disjoint tasks from the
   shared queue without double-claim (claim-safety is enforced by the shared
   `route_state`/optimistic locking now that the store is shared).

### Rollback

Rollback is a flip back, accepting that rows written to the cloud during the
`remote` window stay in the cloud:

1. Re-freeze writers on all machines.
2. Reconcile the shared cloud store back into each machine's local SQLite
   (adapter snapshot pull/import) so no cloud-written work is lost.
3. Flip env back on all machines via config-sync:

   ```
   HASNA_TODOS_STORAGE_MODE=local
   # optionally re-enable HASNA_TODOS_SHADOW=1 to resume mirroring
   ```

4. Restore reads from local SQLite (the dated backup plus reconciled cloud
   rows). Unfreeze.

Because the shadow phase is a pure mirror and the flip is coordinated, at no
point do two machines act as independent writers of the same logical store —
avoiding the split-brain the council rejected.

## Safety invariants

- Never make the RDS instance publicly accessible.
- Never echo the DSN password; pull from Secrets Manager and pipe directly.
- Shadow mode is read-never: it must not introduce a cloud read path.
- The flip is all-machines-together; per-machine flips are prohibited.

## Cloud container runtime boundary

The production image is an ARM64, musl-based Bun container. Its Dockerfile pins
the exact official `oven/bun:1.3.14-alpine` ARM64 manifest digest rather than a
mutable tag or a multi-platform index. Every build stage derives from that same
base, and the build fails unless Bun is 1.3.14, the reviewed musl/OpenSSL/CA
package versions are present, and glibc, Perl, and Alpine SQLite libraries are
absent.

The immutable Bun base currently carries vulnerable OpenSSL 3.5.6-r0 runtime
libraries. The shared base stage must replace `libcrypto3` and `libssl3` with
the exact Alpine v3.22 ARM64 security release 3.5.7-r0 before dependencies or
application output are built. Keep those package versions explicit and fail
the candidate runtime inventory gate if either version drifts. This does not add
the OpenSSL CLI to the application image.

The runner installs only the exact-pinned Alpine `bash` package needed by the
existing event-hook and agent-run execution paths. The predecessor Debian image
did not contain `git` or `tmux`, so those local-workstation capabilities are not
part of the cloud container contract. They must fail clearly when unavailable;
do not silently add them to the image without a separate runtime need, security
scan, and review. The OpenSSL CLI is also intentionally absent: Bun has the
reviewed OpenSSL libraries and the image carries the system CA set plus the RDS
CA bundle.

The production CodeBuild role is intentionally push-only for ECR and cannot
download ECR layers. Candidate builds therefore load the reviewed Bun base from
a unique, versioned object under the private build bucket's `_build/base/`
prefix. The object is a Docker archive produced by pinned Crane from the exact
ECR mirror digest. The build must pin and verify the S3 bucket, key, VersionId,
archive SHA-256, source manifest digest, image config digest, architecture, and
root filesystem layer identities before tagging the loaded image under a local
build-only name. The public Dockerfile default remains the official Docker Hub
digest. Do not fall back to a mutable base tag or widen the builder's ECR policy
without a separately reviewed infrastructure change.

Before an image digest may enter Terraform, require all of the following:

1. Build natively for `linux/arm64` from an exact committed source archive.
2. Record OCI architecture, entrypoint, default command, Bun version, Alpine
   release, `apk info -vv`, musl ELF linkage, SBOM, source revision, archive
   hash, build ID, tag, and immutable digest.
3. Prove the default command is `bun dist/server/index.js`; the migration task
   override is the full `bun dist/server/index.js migrate` command and fails
   closed without a database URL.
4. Run the migration against disposable or staging Postgres, then exercise
   `/health`, `/ready`, `/version`, unauthenticated rejection, authenticated
   CRUD, project listing, and routing/rename/conflict behavior on the built
   image.
5. Prove Postgres TLS hostname and CA verification succeeds with the approved
   CA and fails with a wrong CA and a wrong hostname.
6. Wait for the ECR scan to reach `COMPLETE`; require zero CRITICAL and zero
   HIGH findings without suppressions, and review every MEDIUM, LOW, and unknown
   finding plus application dependencies before approval.

Runtime `node_modules` removal and a non-root user are separate hardening items.
Do not compound those changes with a base-image vulnerability fix.

## Task-comment pagination and historical-redaction rollout

This change has an intentional mixed-version sequence. Do not reverse it.

1. **Rotate or revoke exposed credentials first.** Redacting stored evidence is
   not a substitute for invalidating any credential that may have appeared in a
   historical comment.
2. **Run the migration task before the app rollout.** `todos-serve migrate`
   normalizes legacy JSON payloads, then builds the task-comment cursor index
   with `CREATE INDEX CONCURRENTLY` outside a transaction. Verify the index is
   valid in Postgres before continuing. The request path never owns this index
   build.
3. **Deploy clients first.** Pagination-aware clients always send `limit`. While
   the predecessor server is still running, its unpaginated response is capped
   locally and reported as `pagination_supported: false`; human output says
   older comments were omitted. Confirm this warning path works before changing
   the server.
4. **Deploy the server second.** Requests carrying `limit` receive stable cursor
   pages. A predecessor client sends no `limit`; the server returns its complete
   legacy envelope only up to 500 comments and returns HTTP 426 above that bound
   rather than silently truncating history. Third-party storage adapters remain
   source-compatible through the unchanged `getComments(taskId, context?)`
   contract; they must add the optional `getCommentsPage` capability before the
   server accepts explicit cursor-page requests through them.
5. **Verify both compatibility paths without printing bodies.** Check a small
   history through a predecessor client, a paginated history through the new
   client, and a count-only projection for a task with persisted comments.
6. **Preview the historical rewrite.** Run `todos-serve redact-comments --json`.
   This scans active and deleted/tombstoned comment payloads in bounded batches
   and does not mutate by default. Review only aggregate counts.
7. **Apply only after an explicit data-change approval.** Use `--apply` with the
   confirmation shown by `--help`. Apply uses whole-payload compare-and-set,
   preserves tombstone state, and performs a final rescan. A nonzero conflict or
   remaining-candidate count exits nonzero. Rerun until an apply reports
   `conflicts=0` and `remaining=0`, then run one final dry run and require
   `candidates=0`. Record operator signoff.
8. **Handle immutable history separately.** The rewrite cannot alter prior RDS
   snapshots, WAL archives, or backups. Inventory their retention/restore paths;
   do not shorten or delete retention without separate approval. Any restored
   database stays quarantined from agents until the redaction backfill and a
   zero-candidate dry run have completed.

Rollback the server before clients: the new client remains explicit and bounded
against the predecessor server. Do not roll clients back while the paginated
server is active unless every task is proven below the legacy bound.
