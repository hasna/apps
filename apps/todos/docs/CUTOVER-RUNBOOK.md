# Shared Cloud Task Store — Deferred Stage B Design

> **STAGE A STOP.** This document is design input for a future
> authority-enabled Stage B. Nothing below is operational in Stage A. Do not
> enable shadowing, open a remote datastore, migrate, backfill, flip storage,
> deploy a remote runtime, or run the example provider commands. In Stage A,
> `remote_enabled=false` and `runtime_enabled=false`; `remote_configured` only
> reports configured intent. Every remote operator entry point reaches the
> deterministic authority floor before config, dependencies, SQLite, or
> network access.

This document preserves the proposed migration design for `@hasna/todos` from
disjoint per-machine local SQLite stores to a shared Postgres task store. It may
be activated only after Stage B supplies a trusted authority resolver and a
separately reviewed rollout:

The tracked Dockerfile and compose file are Stage A containment-only artifacts:
their default command renders help and starts no listener. If a future reviewed
image starts the server, `/health` is liveness only; `/ready` remains unavailable
with 503 until trusted authority exists. Stage B defers RDS, migration, and hosted
runtime activation together with their rollback and artifact review.

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

## Deferred terminology and knobs

| Env var | Meaning |
| --- | --- |
| `HASNA_TODOS_STORAGE_MODE` | `local` runs locally; `remote`/`hybrid` record intent and fail closed in Stage A |
| `HASNA_TODOS_SHADOW` | Reserved Stage B intent; it cannot enable a mirror in Stage A |
| `HASNA_TODOS_DATABASE_URL` | Reserved Stage B DSN input; Stage A diagnostics redact it and never connect |
| `HASNA_TODOS_DATABASE_SSL` | Reserved Stage B TLS intent; it does not enable a runtime |

Local-development fallbacks without the `HASNA_` prefix are accepted
(`TODOS_SHADOW`, `TODOS_DATABASE_URL`, ...).

## Deferred Stage B deployment infrastructure

- Supply the target cluster/database, AWS account, region, ECR repository, and
  secret reference through the private deployment environment. Do not commit
  fleet-specific identifiers to this public repository.
- Resolve the runtime DSN from the deployment's approved secret reference.
- The instance is **not** publicly accessible. Reach it from outside the VPC
  only through the SSM port-forward bastion documented in the secret's `ssm`
  block (`AWS-StartPortForwardingSessionToRemoteHost`).

### Deferred Stage B tunnel design (not a Stage A command)

```
aws ssm start-session \
  --target <ssm.target_instance_id> \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["<rds host>"],"portNumber":["5432"],"localPortNumber":["15432"]}'
```

Only an approved Stage B operator would point tooling at `127.0.0.1:15432` with
`sslmode=require`. Never paste the
password on a command line; pull the DSN from Secrets Manager and pipe it
directly into `psql` / the app.

## Deferred Stage B schema

The shared store uses the repo-native sync schema
(`postgresTodosSyncSchemaSql()` in `./storage`): `todos_sync_records`
(keyed by `service, object_type, object_id`) plus `todos_sync_cursors`. Apply
it idempotently before a future Stage B mirror or cutover. The following is a
design excerpt, not an authorized Stage A procedure:

```
bun -e "const m=await import('./src/storage/postgres-sync.ts'); \
  console.log(m.postgresTodosSyncSchemaSql().join(';\n')+';');" > /tmp/todos-schema.sql
psql "$DSN" -v ON_ERROR_STOP=1 -f /tmp/todos-schema.sql
```

All statements use `IF NOT EXISTS`, so re-running is safe.

---

## Deferred Stage B Phase 1 — Dual-write shadow (not live in Stage A)

The proposed shadow mode would wrap the local adapter so successful writes are mirrored
fire-and-forget to the cloud with bounded retries and a divergence counter. It
would never read from the cloud. These values are non-operational intent in Stage A:

```
HASNA_TODOS_STORAGE_MODE=local
HASNA_TODOS_SHADOW=1
HASNA_TODOS_DATABASE_URL=<DSN from the approved deployment secret>
```

In a future Stage B, divergence could be watched with the diagnostic below. In
Stage A both commands fail at the authority floor before opening a DB connection:

```
todos storage shadow-status            # human-readable
todos storage shadow-status --json     # machine-readable
```

The future `shadow-status` design reports per-object-type local vs cloud row counts, cloud
tombstones, `in_sync`, and last mirror lag.

> **Runtime-wiring caveat.** The mirror lives in the storage adapter
> (`createShadowTodosStorageAdapter`). The current CLI/MCP write path still calls
> the `db/*` helpers directly, so `HASNA_TODOS_SHADOW=1` only mirrors writes that
> flow through the storage adapter. Routing the CLI/MCP/server write path through
> the adapter is the prerequisite readiness task before the shadow becomes a full
> live mirror of every machine write, and before Phase 2 is meaningful.

---

## Deferred Stage B Phase 2 — Single-writer flip (not authorized in Stage A)

After trusted authority and separate approval exist, this would be performed as
one coordinated operation across every fleet machine.

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
6. **Unfreeze.** Restart writers only in the future Stage B. Stage A status must
   continue to show `remote_enabled: false` and `runtime_enabled: false`, even
   when `remote_configured: true` records intent.
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

- Stage A never executes any shadow, migration, backfill, flip, or cloud-runtime
  step in this document.
- Never make the RDS instance publicly accessible.
- Never echo the DSN password; pull from Secrets Manager and pipe directly.
- Shadow mode is read-never: it must not introduce a cloud read path.
- The flip is all-machines-together; per-machine flips are prohibited.

## Deferred Stage B cloud container runtime boundary

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
existing event-hook and agent-run execution paths. The compiled server is
self-contained, so the runner must not include the workspace package manifests
or `node_modules` tree. It carries only the pre-bundled contracts CLI file used
by the controlled API-key workflow; the candidate build proves that CLI and all
server workflows function without package metadata or external modules. The
predecessor Debian image
did not contain `git` or `tmux`, so those local-workstation capabilities are not
part of the cloud container contract. They must fail clearly when unavailable;
do not silently add them to the image without a separate runtime need, security
scan, and review. The OpenSSL CLI is also intentionally absent: Bun has the
reviewed OpenSSL libraries and the image carries the system CA set plus the RDS
CA bundle.

The production CodeBuild role may be intentionally push-only for ECR and unable
download ECR layers. Candidate builds therefore load the reviewed Bun base from
a unique, versioned object under the private build bucket's `_build/base/`
prefix. Pass the bucket, key, VersionId, repository, and region as required
private build variables; tracked public build files must not contain fleet
identifiers. The object is a Docker archive produced by pinned Crane from the exact
ECR mirror digest. The build must pin and verify the S3 bucket, key, VersionId,
archive SHA-256, source manifest digest, image config digest, architecture, and
root filesystem layer identities before tagging the loaded image under a local
build-only name. The public Dockerfile default remains the official Docker Hub
digest. Do not fall back to a mutable base tag or widen the builder's ECR policy
without a separately reviewed infrastructure change.

If Stage B is authorized, before an image digest may enter Terraform, require
all of the following. None of these are Stage A procedures:

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
   finding plus application dependencies before approval. Run exact-pinned
   Grype against the pruned final image and require no HIGH or CRITICAL matches;
   retain its JSON report hash with the SBOM and provenance evidence.
7. Attach the source-tree manifest, APK inventory, OCI inspection, SBOM, Grype
   report, and provenance as one OCI 1.1 referrer of the exact image digest with
   checksum-pinned ORAS. Discover the referrer through the registry API and
   record both immutable digests; log-only hashes are not durable evidence.

A non-root user remains a separate hardening item. Do not compound that identity
change with the base-image vulnerability fix and runtime dependency pruning.

## Deferred Stage B task-comment historical-redaction rollout

This proposed data-changing sequence is not available in Stage A: the package
script and server operator command fail at the authority floor. If Stage B is
authorized later, its mixed-version sequence must not be reversed.

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
