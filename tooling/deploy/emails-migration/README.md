# Emails migration-aware current deployment

This protected lane is for the complete current Emails image when immutable OCI
inspection proves that its migration-definition inputs differ from the healthy
live image. It is separate from the image-only lane and from npm release
metadata.

The workflow is manual and exact-main. All three phases share the
`emails-search-production` concurrency group and delegate AWS authority to the
existing IAM-trusted `emails-search-promotion-execute` reusable workflow.

## 1. Reconcile

`phase=reconcile` takes the reviewed healthy anchor reconciliation and both
failed image-only deployment run IDs. It performs no AWS mutation. It verifies
that:

- each historical source is an ancestor and the latest failed candidate has the
  same `apps/emails/**` bytes as the current exact-main source;
- the failed receipts bind their exact registered task and immutable image;
- the live service contains only the anchor and those failed candidates;
- all running service tasks are the healthy anchor image; and
- actual immutable deployed/candidate OCI migration inputs differ.

Review and hash `emails-current-migration-reconciled/reconciled.json`.

## 2. Prepare

`phase=prepare` requires that reviewed reconciliation. It builds, exercises,
scans, and pushes the exact amd64 current image, then:

1. rechecks the reconciled service, task, running image, network and source
   binding;
2. registers an image-only candidate task definition **without updating the
   service**;
3. runs the candidate as a one-shot, read-only production migration planner;
4. records every ledger id/checksum, every candidate migration id/checksum/state,
   the expected post-migration ledger, and canonical checksums for all three.

The planner directly selects the existing production ledger and performs no DDL
or migration. Review and hash
`emails-current-migration-prepared/prepared.json`.

## 3. Execute

`phase=execute` requires the exact reviewed plan and reconciliation. It re-runs
the read-only planner and refuses if any ledger, plan, task, image, source or
service checksum changed. It then writes an intent receipt and starts exactly
one candidate migration task. No automatic retry is allowed when the task start
or result is uncertain.

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
