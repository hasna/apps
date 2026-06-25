# Open Files Adversarial Migration Audit

Date: 2026-06-08

This audit verifies the `open-files` storage migration after canonical S3
promotion, canonical Postgres import, organization queue bootstrap, rollback
policy, and runtime default cutover.

Result: the storage/runtime migration passes. Legacy retirement is still
blocked by the follow-up gates listed at the end of this document.

## Requirements Checked

| Requirement | Evidence | Result |
| --- | --- | --- |
| All 18,212 Drive rows are represented in canonical Postgres. | Direct Postgres query through SSM tunnel: `files=18,212`, `google_drive_imported_objects=18,212`. | Pass |
| Every Drive row maps to a canonical object. | Direct Postgres query: `drive_mapped=18,212`, `drive_missing_canonical_key=0`, `drive_rows_without_file=0`, `files_without_drive_mapping=0`. | Pass |
| Canonical object de-duplication matches expected object count. | Direct Postgres query: `distinct_canonical_keys=15,648`; S3 summary for `objects/sha256/`: 15,648 objects / 128,358,442,514 bytes. | Pass |
| Source and canonical raw object counts/bytes match. | S3 summaries: `s3://hasna-xyz-prod-files/google-drive/` has 18,212 objects / 132,917,143,313 bytes; `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/raw/` has the same count and bytes. | Pass |
| Old email bucket path is not the full source of record. | S3 summary: `s3://hasna-xyz-prod-emails/drive/` has only 128 objects / 348,381,076 bytes. | Pass |
| No active runtime dependency on `hasna-xyz-prod-emails/drive`. | Direct Postgres query: `active_legacy_email_sources=0`, `active_canonical_sources=1`; source `src_p8WUDEpmRP` is `prod-files-drive`, bucket `hasna-xyz-opensource-files-prod`, prefix `imports/google-drive/live`, region `us-east-1`, enabled. Local source list matches. | Pass |
| Canonical source row still resolves imported Drive files through immutable canonical objects, not the live-import prefix. | CLI, SDK, and MCP all resolved file `f_0_7yEJlFSG` as `google_drive_canonical_s3` at `objects/sha256/18/fa/18fa26fa74685c3bd2547879e4db1c41d7b6ecfe7fe7799ec8fc8d24af0e457b` in `hasna-xyz-opensource-files-prod`. | Pass |
| Representative small-file download verifies bytes. | `files download f_0_7yEJlFSG /tmp/open-files-audit-small.svg`; `sha256sum` returned `18fa26fa74685c3bd2547879e4db1c41d7b6ecfe7fe7799ec8fc8d24af0e457b`; `wc -c` returned 70. | Pass |
| Representative large file is mapped without downloading the 19GB object. | Direct Postgres query for `f_9BdHQJGCPN`: size `19,344,300,537`, canonical key `objects/sha256/4e/10/4e108c977a1cd76f2c26881f11e30d22d017ea7b512936c0a216743c14f7d91a`, canonical SHA-256 matches key. | Pass |
| Canonical bucket controls are enabled. | AWS S3 checks on `hasna-xyz-opensource-files-prod`: versioning enabled, public access block all true, default SSE AES256, bucket owner enforced. | Pass |
| No incomplete multipart uploads remain under canonical object prefix. | `list-multipart-uploads` for `objects/sha256/` returned `null`. | Pass |
| Canonical local and AWS secrets resolve without value leaks. | Local `secrets list hasna/xyz/opensource/files/prod` and AWS Secrets Manager both show `aws`, `env`, `rds`, and `s3`. Key-shape checks were run for each secret; no secret values were printed. | Pass |
| CLI/SDK/MCP smoke coverage exists. | `bun run typecheck` passed. `bun test src/cli/sources.test.ts src/db/storage-config.test.ts src/cli/evidence.test.ts src/lib/evidence.test.ts src/lib/file-object.test.ts src/db/organization.test.ts src/lib/google-drive.test.ts src/lib/s3.test.ts` passed 38 tests. Direct CLI resolve/download, SDK resolver, and MCP `resolve_file_storage` handler checks all resolved canonical S3. | Pass |
| Rollback docs exist. | `docs/open-files-legacy-rollback-policy.md` documents legacy resources, freeze rules, rollback procedures, retention gates, and evidence required before deletion. | Pass |
| Organization queue exists and is in canonical Postgres. | Direct Postgres query: `file_organization_reviews=18,212`, `review_missing_canonical_metadata=0`, `collection_files=22,594`, `collections=11`. | Pass |

## Direct Postgres Evidence

Canonical Postgres was queried through SSM target `i-086c334559bec7e0f`.
The tunnel was closed after the query.

```json
{
  "files": 18212,
  "sources": 6,
  "drive_rows": 18212,
  "drive_mapped": 18212,
  "drive_missing_canonical_key": 0,
  "drive_rows_without_file": 0,
  "files_without_drive_mapping": 0,
  "distinct_canonical_keys": 15648,
  "active_legacy_email_sources": 0,
  "active_canonical_sources": 1,
  "review_rows": 18212,
  "review_unreviewed": 18212,
  "review_missing_canonical_metadata": 0,
  "collection_files": 22594,
  "collections": 11
}
```

Verified canonical source row:

```json
{
  "id": "src_p8WUDEpmRP",
  "name": "prod-files-drive",
  "bucket": "hasna-xyz-opensource-files-prod",
  "prefix": "imports/google-drive/live",
  "region": "us-east-1",
  "enabled": true
}
```

## S3 Evidence

```json
{"bucket":"hasna-xyz-prod-files","prefix":"google-drive/","objects":18212,"bytes":132917143313}
{"bucket":"hasna-xyz-opensource-files-prod","prefix":"imports/google-drive/legacy-s3-2026-06-07/raw/","objects":18212,"bytes":132917143313}
{"bucket":"hasna-xyz-opensource-files-prod","prefix":"objects/sha256/","objects":15648,"bytes":128358442514}
{"bucket":"hasna-xyz-prod-emails","prefix":"drive/","objects":128,"bytes":348381076}
```

Canonical bucket controls:

```txt
versioning: Enabled
public access block: BlockPublicAcls=true, IgnorePublicAcls=true, BlockPublicPolicy=true, RestrictPublicBuckets=true
encryption: AES256 default encryption; SSE-C blocked
ownership: BucketOwnerEnforced
incomplete multipart uploads under objects/sha256/: none
```

## Runtime Smoke Evidence

CLI resolver:

```txt
f_0_7yEJlFSG -> google_drive_canonical_s3
bucket: hasna-xyz-opensource-files-prod
key: objects/sha256/18/fa/18fa26fa74685c3bd2547879e4db1c41d7b6ecfe7fe7799ec8fc8d24af0e457b
```

Small-file download:

```txt
sha256: 18fa26fa74685c3bd2547879e4db1c41d7b6ecfe7fe7799ec8fc8d24af0e457b
bytes: 70
```

SDK resolver:

```json
{
  "sdk_kind": "google_drive_canonical_s3",
  "sdk_bucket": "hasna-xyz-opensource-files-prod",
  "sdk_key": "objects/sha256/18/fa/18fa26fa74685c3bd2547879e4db1c41d7b6ecfe7fe7799ec8fc8d24af0e457b"
}
```

MCP `resolve_file_storage` handler:

```json
{
  "mcp_kind": "google_drive_canonical_s3",
  "mcp_bucket": "hasna-xyz-opensource-files-prod",
  "mcp_key": "objects/sha256/18/fa/18fa26fa74685c3bd2547879e4db1c41d7b6ecfe7fe7799ec8fc8d24af0e457b"
}
```

## Legacy References

Repository search still finds `hasna-xyz-prod-emails/drive`,
`hasna-xyz-prod-files/google-drive`, `hasna-files-prod`, and
`prod-emails-drive` in expected places:

- migration and rollback documentation,
- tests that intentionally model stale legacy sources,
- compatibility repair sets in `bootstrap-prod-files`,
- historical source names in resolver tests.

These are not active runtime dependencies. Active local and remote source state
has zero enabled `hasna-xyz-prod-emails/drive` sources.

## Legacy Guardrail Update - 2026-06-08

After runtime cutover and this audit, AWS-side deny-write guardrails were
applied for the protected legacy Drive prefixes:

```txt
hasna-xyz-prod-files/google-drive/
  DenyOpenFilesLegacyGoogleDriveWritesExceptBreakGlass
hasna-xyz-prod-emails/drive/
  DenyOpenFilesLegacyEmailDriveWritesExceptBreakGlass
break-glass:
  arn:aws:iam::789877399345:role/hasna-xyz-open-files-legacy-drive-breakglass-prod
```

Read access remains available for rollback and audit. Representative
`head-object` checks succeeded for one object under each protected prefix after
the policy update. IAM simulation of the applied policies, stripped of resource
policy `Principal` fields for simulation, returned `explicitDeny` for
`s3:PutObject` and `s3:DeleteObject` on both protected prefixes for the normal
`OrganizationAccountAccessRole` principal.

Recurring inventory state:

- `hasna-xyz-opensource-files-prod` has a completed daily ORC inventory report
  for `2026-06-08T01-00Z` in
  `s3://hasna-xyz-infra-inventory-prod/s3/hasna-xyz-opensource-files-prod/`.
- `hasna-xyz-prod-files/google-drive/` has a completed daily ORC inventory
  report for `2026-06-08T01-00Z` in
  `s3://hasna-xyz-infra-inventory-prod/s3/hasna-xyz-prod-files/google-drive/`.
- `hasna-xyz-prod-emails/drive/` now has daily ORC inventory configured to the
  same-region bucket prefix
  `s3://hasna-xyz-prod-emails/inventory/open-files-legacy-drive/`; S3 Inventory
  requires the destination bucket to be in the source bucket's region.
- The `hasna-xyz-prod-emails/drive/` filtered report prefix is still empty as
  of the 2026-06-09 evidence pass, but task `3fae082e` has equivalent
  metadata-only manifest evidence for that 128-object prefix.

2026-06-09 inventory evidence asset:

```txt
asset: asset_d636d93ea2944da6
s3: s3://hasna-xyz-opensource-files-prod/orgs/hasna-xyz/companies/_global/open-files/2026/06/s3-inventory-evidence/asset_d636d93ea2944da6/open-files-s3-inventory-evidence-20260609T025315Z.tar.gz
sha256: 7abb42272087837e7c21fcc9e262c7bf5342a2ac901352b43b303ddb3602c0f3
size: 3,720,796 bytes
status: verified
```

## Remaining Gates

Do not retire or delete legacy Drive resources yet. The storage/runtime audit
passes, but these gates remain open:

- `2b590b38`: work down all 18,212 Drive organization rows and owner/ACL
  approvals.
- `de9ca453` / `24adad56`: broader cross-account adversarial verification.

## Decision

`open-files` canonical storage and runtime cutover are verified. It is safe to
continue operating from canonical S3/Postgres. It is not yet safe to retire
legacy Drive storage until the remaining gates pass.
