# Emails migration-aware current deployment

This protected lane is for the complete current Emails image when immutable OCI
inspection proves that its migration-definition inputs differ from the healthy
live image. It is separate from the image-only lane and from npm release
metadata.

The workflow is manual and exact-main. All three phases share the
`emails-search-production` concurrency group and delegate AWS authority to the
existing IAM-trusted `emails-search-promotion-execute` reusable workflow.

## 1. Reconcile

`phase=reconcile` takes the reviewed historical healthy anchor reconciliation
and both failed image-only deployment run IDs. Run it only after a separately
reviewed KMS key and ECS task-definition baseline has become healthy. It
performs no AWS mutation. It verifies that:

- each historical source is an ancestor and the latest failed candidate has the
  same `apps/emails/**` bytes as the current exact-main source;
- the failed receipts bind their exact registered task and immutable image to
  the historical anchor, even though that revision is no longer live;
- the current healthy task keeps the historical image and task configuration
  byte-for-byte except for the paired KMS key and region environment settings;
- the live service contains only the historical anchor, those failed
  candidates, and the current KMS-enabled anchor;
- all running service tasks use the healthy KMS-enabled anchor image; and
- actual immutable deployed/candidate OCI migration inputs differ.

Review and hash `emails-current-migration-reconciled/reconciled.json`.

## 2. Prepare

`phase=prepare` requires that reviewed reconciliation. It builds, exercises,
scans, and pushes the exact amd64 current image, then:

1. rechecks the reconciled service, task, running image, network and source
   binding;
2. registers an image-only candidate cloned from the KMS-enabled task
   definition **without updating the service**;
3. runs the candidate as a one-shot, read-only production migration planner;
4. proves a live KMS GenerateDataKey/Decrypt round trip from the candidate task
   role before any database migration or service update;
5. records every ledger id/checksum, every candidate migration id/checksum/state,
   the expected post-migration ledger, and canonical checksums for all three.

The planner directly selects the existing production ledger and performs no DDL
or migration. Review and hash
`emails-current-migration-prepared/prepared.json`.

## 3. Execute — disabled pending a separate reviewed activation

The workflow still displays `execute`, but the exact-main gate and deployment
entrypoint both reject it
with `MIGRATION_EXECUTION_DISABLED` before assuming AWS authority or running a
migration. Do not use the following draft behavior as an operational runbook.

Activation requires a separately reviewed migration identity and transaction or
lock boundary, data-preservation proof for forced-RLS tables, quiesced old
writers, paired API/ingest-worker cutover, a recovery point, and durable
reconciliation of an uncertain one-shot task launch.

`phase=execute` requires the exact reviewed plan and reconciliation. It repeats
the read-only ledger plan and candidate KMS round trip before writing a migration
intent or starting a migration task. A changed ledger, plan, task, image, source,
service, or KMS proof leaves the database and service unchanged. It then starts
exactly one candidate migration task. No automatic retry is allowed when the
task start or result is uncertain.

After a successful forward migration, rollback is forbidden. The lane records
the before/after ledgers, performs exactly one ECS service update to the reviewed
candidate, and waits for roll-forward health. A later failure retains a
`roll-forward-required.json` receipt and never restores the old task, because
the old binary may reject the forward ledger.

The final phase proves:

- exact candidate task definition, payload and immutable image;
- one stable healthy service deployment and running-task image identity;
- the reviewed final migration ledger with no pending migrations;
- a live task-role KMS GenerateDataKey/Decrypt round trip with no key material
  emitted;
- canonical `https://api.hasna.com/emails` routing, one `/v1`, provider
  credential operations and reply authority; and
- one migration run and one service update.

All receipts are metadata-only. Task ARNs used for one-shot planning, migration,
and proof tasks are retained only as SHA-256 values. Task environments, database
URLs, KMS identifiers, provider credentials, plaintext keys and raw CloudWatch
messages are never emitted.
