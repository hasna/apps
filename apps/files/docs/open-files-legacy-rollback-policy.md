# Open Files Legacy Rollback And Read-Only Policy

Date: 2026-06-08

This policy covers the Google Drive archive migration from legacy S3 and local
SQLite into the canonical `open-files` storage layout for Hasna XYZ.

The default rule is conservative: legacy resources stay readable and are not
deleted until canonical S3, canonical Postgres, app runtime cutover, and
adversarial audit have all passed.

## Current Canonical State

Canonical runtime targets:

```txt
S3 bucket: hasna-xyz-opensource-files-prod
Canonical object prefix: objects/sha256/
Raw import prefix: imports/google-drive/legacy-s3-2026-06-07/raw/
RDS instance: hasna-xyz-infra-apps-prod-postgres
RDS database: files
RDS app role: files_app
RDS app secret: hasna/xyz/opensource/files/prod/rds
```

Verified migration evidence:

```txt
Drive rows: 18,212
Canonical object keys: 15,648
Canonical object bytes: 128,358,442,514
Drive rows mapped in Postgres: 18,212
Drive rows missing canonical mapping: 0
Live smoke evidence: /tmp/open-files-canonical-smoke-x85Wr4
```

Canonical access must resolve Drive-backed file bytes through
`google_drive_imported_objects.file_record_id` first. Do not trust
`files.source_id` alone for migrated Drive files, because those rows still point
at a legacy S3 source. The shared resolver handles this by preferring canonical
Drive mappings before falling back to source/path.

## Legacy Resources

Keep these readable:

| Resource | Role | Policy |
| --- | --- | --- |
| `s3://hasna-xyz-prod-files/google-drive/` | Full legacy Google Drive source of record: 18,212 objects / 132,917,143,313 bytes. | Read-only. Do not delete or rewrite before final retirement approval. |
| `s3://hasna-xyz-prod-emails/drive/` | Partial legacy location referenced by the old active source row: 128 objects / 348,381,076 bytes. | Read-only. Do not use as the rollback source of record for Drive files. |
| `s3://hasna-xyz-prod-files/andreihasnacom/` | Partial older prefix: 44 objects / 248,531,483 bytes. | Read-only until adversarial audit confirms no needed-only-here files. |
| `s3://hasna-files-prod/` | Early open-files smoke evidence: 2 objects / 109 bytes. | Copied and byte-verified in the canonical bucket under `imports/legacy-buckets/hasna-files-prod-2026-06-08/raw/`; keep source readable until retirement gates close. |
| `s3://hasna-backup-googledrive/` in the base `hasna` account | Older backup split across My Drive and Shared Drives. | Read-only backup reference. Do not retire as part of this app cutover. |
| `~/.hasna/files/files.db` on the current production machine | Local SQLite snapshot/source for the imported metadata. | Keep as rollback input. Do not mutate during cutover tests without a timestamped copy. |
| Promotion manifest/result/mapping objects under `imports/google-drive/legacy-s3-2026-06-07/manifests/` | Audit trail proving row-to-object mapping. | Immutable audit evidence. Never overwrite; append new artifacts only. |
| Canonical raw import prefix `imports/google-drive/legacy-s3-2026-06-07/raw/` | Canonical copy of raw legacy source objects. | Read-only import evidence. Do not use for runtime downloads except break-glass debugging. |

## Freeze Rules

Immediate soft freeze:

- Do not run new Google Drive imports into legacy buckets.
- Do not run `bootstrap-prod-files` or `bootstrap-prod-emails` as a way to
  re-point the migrated archive back to legacy bucket names.
- Do not write new app data under legacy Drive prefixes.
- Do not write new app data to `s3://hasna-files-prod/`; use
  `hasna-xyz-opensource-files-prod`.
- Use canonical secrets and env vars for smoke/cutover tests:
  `hasna/xyz/opensource/files/prod/rds`,
  `hasna/xyz/opensource/files/prod/{s3,env,aws}` where present, and bucket
  `hasna-xyz-opensource-files-prod`.

Hard freeze after runtime cutover:

- Disable scheduled or manual writers that target
  `s3://hasna-xyz-prod-files/google-drive/` or
  `s3://hasna-xyz-prod-emails/drive/`.
- Add an S3 deny-write guardrail or equivalent IAM restriction for legacy Drive
  prefixes, with a documented break-glass role for rollback reads and emergency
  restores.
- Keep `GetObject`, `ListBucket`, and inventory/audit access available until
  the retirement gates pass.

## AWS Guardrail State - 2026-06-08

The legacy Drive write freeze has been applied in AWS for the two migrated
Drive prefixes:

| Bucket | Prefix | Deny statement | Inventory |
| --- | --- | --- | --- |
| `hasna-xyz-prod-files` | `google-drive/` | `DenyOpenFilesLegacyGoogleDriveWritesExceptBreakGlass` | Daily ORC inventory `open-files-legacy-google-drive-daily` to `s3://hasna-xyz-infra-inventory-prod/s3/hasna-xyz-prod-files/google-drive/`; report `2026-06-08T01-00Z` delivered. |
| `hasna-xyz-prod-emails` | `drive/` | `DenyOpenFilesLegacyEmailDriveWritesExceptBreakGlass` | Daily ORC inventory `open-files-legacy-drive-daily` to same-region `s3://hasna-xyz-prod-emails/inventory/open-files-legacy-drive/`; no filtered report object yet as of the 2026-06-09 evidence pass, so an equivalent metadata manifest is attached. |

Break-glass write exception:

```txt
arn:aws:iam::789877399345:role/hasna-xyz-open-files-legacy-drive-breakglass-prod
```

The deny-write policy covers object writes, ACL/tagging writes, deletes,
multipart aborts, and restores under the protected prefixes. Normal infra role
policy simulation returned `explicitDeny` for `s3:PutObject` and
`s3:DeleteObject` on both protected prefixes. Read/list access is still
available: `head-object` succeeded against one representative object in each
legacy prefix after the policy change.

Canonical bucket inventory is already producing reports:

```txt
s3://hasna-xyz-infra-inventory-prod/s3/hasna-xyz-opensource-files-prod/...
report: daily-inventory/2026-06-08T01-00Z
format: ORC
objects listed in inventory output prefix: 5
bytes in inventory output prefix: 1,561,476
```

Post-guardrail inventory/equivalent manifest evidence was attached on
2026-06-09:

```txt
asset: asset_d636d93ea2944da6
s3: s3://hasna-xyz-opensource-files-prod/orgs/hasna-xyz/companies/_global/open-files/2026/06/s3-inventory-evidence/asset_d636d93ea2944da6/open-files-s3-inventory-evidence-20260609T025315Z.tar.gz
sha256: 7abb42272087837e7c21fcc9e262c7bf5342a2ac901352b43b303ddb3602c0f3
size: 3,720,796 bytes
status: verified
```

The evidence bundle contains inventory configuration snapshots, delivered
inventory manifest references, and metadata-only prefix manifests:

```txt
hasna-xyz-prod-files/google-drive/: 18,212 objects / 132,917,143,313 bytes
hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/raw/: 18,212 objects / 132,917,143,313 bytes
hasna-xyz-opensource-files-prod/objects/sha256/: 15,648 objects / 128,358,442,514 bytes
hasna-xyz-prod-emails/drive/: 128 objects / 348,381,076 bytes
```

The `hasna-xyz-prod-files/google-drive/` formal ORC inventory report is present
at `2026-06-08T01-00Z`. The small `hasna-xyz-prod-emails/drive/` filtered
inventory report has not emitted to its filtered destination prefix yet, but the
same evidence bundle includes an equivalent 128-object metadata manifest and
the bucket-level regional inventory report.

## Rollback Procedures

### Runtime rollback

Use this if the app runtime fails after switching defaults to canonical storage.

1. Stop writes in `open-files` workers/CLI jobs.
2. Revert runtime env/secrets to the last known-good configuration.
3. If rolling back Drive object reads, use
   `s3://hasna-xyz-prod-files/google-drive/` as the raw source of record, not
   `s3://hasna-xyz-prod-emails/drive/`.
4. Restore the previous local SQLite DB from the timestamped snapshot if the
   local runtime DB was changed.
5. Keep canonical S3/Postgres intact. Do not delete canonical objects or rows
   during rollback.
6. Record the failing command, error, affected file IDs, and rollback timestamp
   in todos and conversations.

### Metadata rollback

Use this if canonical Postgres rows are wrong or incomplete.

1. Stop app writes.
2. Keep the current RDS database for forensics; do not drop it.
3. Re-run the idempotent metadata import from the SQLite snapshot and canonical
   mapping artifact, or restore from an RDS snapshot if corruption is wider.
4. Verify:
   `files=18,212`, `google_drive_imported_objects=18,212`,
   `drive_mapped=18,212`, `drive_missing_mapping=0`.
5. Re-run CLI/SDK/MCP smoke before reopening writes.

### Object rollback

Use this if a canonical object is missing or corrupted.

1. Locate the row in `google_drive_imported_objects` by `file_record_id` or
   canonical key.
2. Compare `raw_bucket`, `raw_key`, `canonical_bucket`, `canonical_key`, size,
   and SHA-256 from the mapping artifact.
3. Re-copy from the canonical raw import prefix if present; otherwise re-copy
   from `s3://hasna-xyz-prod-files/google-drive/`.
4. Recompute SHA-256 from S3 bytes and update only the mapping row if the
   canonical key truly changes. Prefer restoring the expected canonical key.
5. Re-run the small-object or affected-object download smoke.

## Retention And Retirement Gates

Do not delete or archive legacy Drive resources until all of these are true:

- `open-files` runtime defaults have been cut to canonical S3/Postgres.
- The archive organization/review queue bootstrap is available.
- The legacy rollback policy is approved and linked from the cutover task.
- The open-files adversarial audit passes.
- Cross-account adversarial verification passes for S3, secrets, and RDS.
- No active code/config references `hasna-xyz-prod-emails/drive` as the Drive
  archive source.
- At least one full S3 inventory or equivalent object-count/byte-count evidence
  exists for canonical objects after cutover; this is satisfied by the
  `2026-06-08T01-00Z` canonical bucket inventory.
- At least one completed inventory or equivalent manifest exists for the
  protected legacy Drive prefixes after the deny-write guardrail was applied.
  This is satisfied by evidence asset `asset_d636d93ea2944da6`.
- The app has completed a rollback window with no unresolved data-loss bugs.

Minimum retention:

- Keep `s3://hasna-xyz-prod-files/google-drive/` for at least 90 days after
  runtime cutover and until explicit owner approval.
- Keep promotion manifests, result files, mapping artifact, and canonical raw
  import prefixes indefinitely as audit evidence unless a later retention policy
  supersedes this document.
- Keep the base `hasna-backup-googledrive` backup out of the app retirement
  process; it needs separate account-level backup policy approval.

## Evidence Required Before Legacy Deletion

Before deleting or deep-archiving any legacy Drive resource, attach evidence for:

- Source and target object counts and bytes.
- Canonical mapping coverage: 18,212 rows, 0 missing.
- Canonical object prefix summary: 15,648 objects, 128,358,442,514 bytes.
- Representative checksum verification, including at least one small file and
  the >5GiB file metadata record.
- CLI, SDK, and MCP smoke results.
- Canonical RDS row counts and large-row verification.
- Canonical S3/RDS secrets resolving locally and in AWS without printing values.
- A search for hard-coded legacy bucket paths in relevant repos.
- Rollback dry-run notes or a documented rollback command sequence.
- Approval from the owner responsible for replacing Google Drive with
  `open-files`.

## Current Next Steps

1. Work down the Drive organization queue and owner/ACL approvals.
2. Run the broader cross-account adversarial migration verification.
3. Retire legacy resources only after the rollback window and owner approval.
