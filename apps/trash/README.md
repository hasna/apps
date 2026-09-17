# @hasna/trash

Reversible deletion for agents. The hosted CLI, MCP and SDK use `https://api.hasna.com/trash/v1`: PostgreSQL owns metadata; versioned S3 stores verified recovery capsules. A station keeps only unfinished filesystem operations locally. Missing credentials never enable a local metadata fallback.

## Agent workflow

```sh
trash setup
trash put ./obsolete-folder
trash list --limit 20 --station station06 --path obsolete
trash info ENTRY_ID
trash restore ENTRY_ID
trash hold ENTRY_ID
trash retention ENTRY_ID --days 180
trash backup ENTRY_ID
```

Output is compact JSON by default. Lists contain at most 20 rows unless requested, capped at 100, with a `nextCursor`. Pass it using `--cursor`. Lists never return file contents or signed transfer URLs. `info` fetches one full metadata record. Filters include station, agent, literal path text, kind, state, Backup state and user hold. Restored and expired records require an explicit state filter.

`trash guard -rf PATH` accepts rm grammar for the shell hook. Force does not authorize an uncaptured deletion. `trash guard --plan 'rm -rf ./build'` shows the rewrite without authentication or filesystem changes. Exit codes: 0 completed, 1 usage/API failure, 2 deletion refused.

Credentials resolve through `@hasna/contracts`, including owner-only `~/.hasna/trash/config/credentials`. Its API base is `https://api.hasna.com/trash`; clients append `/v1`. Provision a separate signed key for each station. Detection uses `HASNA_TRASH_STATION`, `HASNA_STATION`, Tailscale's self identity, then hostname. The service verifies that the detected name matches the signed credential subject; changing an environment label cannot claim another station. Captures record agent name, harness and session when supplied or detected.

## Capture, restore and retention

1. Inspect the source without following symlinks and create a private capsule with a manifest and hashes.
2. Reserve hosted metadata, upload with a create-only condition, and verify the entire immutable object version.
3. Confirm the source has not changed. Move it into a private sibling staging directory and commit removal through an idempotent API operation.
4. Reverify the exact remote version, then remove only unchanged captured members from staging.

The default retention is **90 days from committed removal**, configurable from 1–3650 days or `never`. User holds and pending, running or failed Backup requests prevent expiry. An independent server worker expires eligible object versions and retains metadata tombstones. Configure **no S3 object-expiration lifecycle** on the Trash bucket: bucket expiry cannot see holds. An active restore lease also protects its object.

Restore creates the destination exclusively and verifies every file. It refuses an occupied path. Restoring on another station requires `--to PATH`; the original station's path is never silently used there. Files, directories, modes and symlink objects are supported. Capsules currently support up to 2 GiB of content, 100,000 members, 64 directory levels and a 16 MiB manifest. Extended attributes, ACLs, ownership and hardlink relationships are not preserved; special files and privileged mode bits are refused.

## Interruptions

```sh
trash pending
trash recover OPERATION_ID
trash recover RESTORE_OPERATION_ID --to /new/empty/destination
```

An upload failure leaves the source untouched. A source changed during upload is preserved. An interruption after staging or a lost API response retains the capsule, staged source and operation journal until recovery reconciles authoritative state. A partial restore is preserved; `recover --to` can select a fresh destination. `pending` works without credentials.

Operation directories are owner-only. Unknown contents and checksum changes are preserved for inspection. Locks are never stolen by elapsed time. A process killed while holding a filesystem lock requires quiescent operator recovery: stop all Trash writers, verify the recorded host/PID is no longer active, preserve the lock and operation evidence, then remove only the confirmed abandoned lock. Do not delete a whole spool to clear an error.

## Backup handoff

`trash backup ID` marks an entry for the separate Backup worker. It immediately protects the Trash copy. An ordinary station credential cannot claim or complete Backup jobs. Completion requires a `trash:backup` credential and a receipt for the exact artifact, with a held backup and verified restore. A user hold remains independent.

The private Backup adapter imports through the existing Backup app. Production handoffs additionally require S3 versioning, Object Lock and verified legal holds on the exact archive and manifest versions. Backup failure leaves Trash protection active. Worker deployment is a separate operational prerequisite; requesting Backup is not evidence that the handoff finished. Check `backup: "verified"` and the detail receipt.

To recover after the Trash retention period, restore the archive through Backup, then recover its `payload.capsule`:

```sh
trash restore-capsule /restored-backup/source/payload.capsule --to /new/destination
```

Capsule recovery verifies the complete artifact and refuses overwrite. It does not require the original Trash API credential or change hosted history.

## SDK and MCP

```ts
import { createTrash, TrashApi } from '@hasna/trash/sdk';
const files = createTrash();
const entry = await files.put('./obsolete-folder', { agent: 'codex', retentionDays: 90 });
const page = await new TrashApi().list({ limit: 20, station: 'station06' });
await files.restore(entry.id);
```

Run `trash-mcp --stdio` for standard newline-delimited MCP. Tools cover status, setup, compact list, detail, put, restore, hold, retention, Backup request, pending operations and recovery. No permanent-delete or raw-blob tool is exposed. Mutations report compact metadata and fixed, redacted errors.

The `hook-trash-guard` integration in `@hasna/hooks` validates the Hasna binary identity before rewriting supported shell deletions. A shell hook covers only the native tool events where it is installed. It does not intercept arbitrary filesystem syscalls, application-native delete APIs, or an agent's file-edit tool. Configure agents to use the Trash CLI/MCP for removals and verify each harness's installed hook coverage; a shell alias is not system-wide enforcement.

`--local` / `HASNA_TRASH_LOCAL=1` and `createLocalTrash()` explicitly select the legacy offline store. Its entries have no hosted station index. Legacy config, sweep, empty and purge commands apply only to that store.

## Service and verification

`trash-serve` listens on `0.0.0.0:8080` by default. Configure `HASNA_TRASH_DATABASE_URL`, `HASNA_TRASH_API_SIGNING_KEY`, `HASNA_TRASH_S3_BUCKET` and `HASNA_TRASH_S3_REGION`. AWS credentials use the standard SDK chain, including an ECS task role. Run `trash-serve migrate` separately before startup. Migration needs only PostgreSQL authority. Public `/health`, `/ready`, `/version` and `/openapi.json` describe the service; `/ready` checks PostgreSQL, bucket versioning and lifecycle constraints.

Every mutation requires an `Idempotency-Key`; entry actions also require the current numeric `If-Match` version. Reusing a key for a different canonical request conflicts. Authentication, tenant scope, station bindings, revocation and worker permissions are enforced at the service.

```sh
bun run verify
TRASH_TEST_DATABASE_URL=postgresql://.../disposable_trash_test bun run test:postgres
```

The PostgreSQL gate exercises real metadata/authentication/HTTP/retention and CLI/MCP filesystem flows with a clearly labeled fixture object adapter. It is not live S3 or deployment acceptance. Release acceptance separately requires real object transfer, canonical API authentication denial, native station capture/restore, Backup handoff and exact package/image receipts.
