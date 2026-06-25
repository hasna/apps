# Hasna XYZ Storage Migration Plan

Date: 2026-06-07
Last updated: 2026-06-10

This plan records the target S3, Secrets Manager, local `secrets` CLI, and RDS
structure for Hasna XYZ apps. It also records the current legacy buckets that
must stay readable while `open-files` replaces Google Drive.

## Decisions

- Bucket names use hyphens:
  `hasna-{division}-{app_type}-{app}-{env}`.
- Secret names use ownership-based paths:
  `hasna/{division}/{app_type}/{app}/{env}/{component}` for app-owned runtime
  secrets, and infra-owned paths such as
  `hasna/{division}/infra/apps/{env}/{engine}/{role}` for shared admin/infra
  credentials.
- `division` is `xyz` for Hasna XYZ.
- `app_type` values are `opensource`, `internalapp`, `companywebsite`,
  `project`, and `infra`.
- Do not use `open-`, `iapp-`, `cweb-`, or `project-` in the canonical app
  segment. Strip those repo prefixes.
- Do not use `connector`, `website`, or shared `platform` as app types.
  `connector` is a feature/source category, `website` is replaced by
  `companywebsite`, and `platform` clashes with Hasna Studio/Tools platform
  apps.
- Workspace scan evidence:
  - `/home/hasna/workspace/hasna/opensource/open-*` maps to `opensource`.
  - `/home/hasna/workspace/hasnaxyz/internalapp/iapp-*` maps to
    `internalapp`.
  - `/home/hasna/workspace/hasnaxyz/companywebsite/cweb-*` maps to
    `companywebsite`.
  - `/home/hasna/workspace/hasnaxyz/project/project-*` maps to `project`.
  - `.connectors/connect-*` are connector implementations/sources, not app
    owners in this bucket naming layer.
  - Hasna Studio/Tools have `platform` folders, so `platform` is intentionally
    not used as a generic Hasna XYZ app type.
- `opensource/opensourcedev/open-*` folders are dev variants, not separate prod
  apps. They use the same app names and should not receive duplicate prod
  buckets unless promoted.
- Stale todos project rows are not bucket owners by themselves. On 2026-06-10,
  task `a1fb34a0` corrected machine-local path overrides for unambiguous current
  paths and recorded the empty `open-maropost-backup` row as a non-owner.
- Non-open-source stale todos rows follow the same rule. On 2026-06-10, task
  `efa0f406` corrected unambiguous `companywebsite`/`project` path overrides and
  recorded missing alias/planning rows as non-owners unless promoted.
- Removed `projectmaintain` rows follow the same rule. On 2026-06-10, task
  `c676ad24` registered current `project-rotaxes` and `project-ustrademarks`
  todos projects and added their missing S3/secrets migration chains.
- Remaining project matrix rows are explicitly covered. On 2026-06-10, task
  `45a1f34c` added pending chains for `project-agentavatars`,
  `project-aicreditsgrants`, and `project-payroll`, and completed no-storage
  evidence for `project-cancelsubscriptions`, `project-designreverseengineering`,
  `project-sessionsync`, and `project-usvirtualaddresses`.
- Remaining internalapp matrix rows are explicitly covered. On 2026-06-10, task
  `a2caee1f` registered 34 current `iapp-*` todos project rows, added pending
  ownership chains for `iapp-music` and `iapp-signatures`, and completed
  current no-storage evidence for 29 other live internalapps. `iapp-music`
  must decide open-files-owned media versus `hasna-xyz-internalapp-music-prod`;
  `iapp-signatures` must decide shared attachments/open-files versus
  `hasna-xyz-internalapp-signatures-prod`. Their provisioning,
  migration/no-op, and legacy-retention children require approval.
- Existing buckets remain legacy until every app and import has been cut over.

Examples:

```txt
S3 bucket: hasna-xyz-opensource-files-prod
AWS secret: hasna/xyz/opensource/files/prod/env
local secrets CLI: hasna/xyz/opensource/files/prod/env

S3 bucket: hasna-xyz-internalapp-accounting-prod
AWS secret: hasna/xyz/internalapp/accounting/prod/env
local secrets CLI: hasna/xyz/internalapp/accounting/prod/env

RDS secret: hasna/xyz/infra/apps/prod/postgres/master
RDS identifier: hasna-xyz-infra-apps-prod-postgres
```

## Current AWS State

Account: `hasna-xyz-infra` (`789877399345`).

Buckets currently present:

| Bucket | Region | Role |
| --- | --- | --- |
| `hasna-files-prod` | `us-east-1` | Early evidence bucket. The two smoke objects found there were copied into the canonical bucket under `imports/legacy-buckets/hasna-files-prod-2026-06-08/raw/`; keep the source readable until retirement gates close. |
| `hasna-internalapps-prod-deploy-789877399345` | `us-east-1` | Existing internal app deploy artifacts. Latest iapp-news artifact and all source versions copied to `hasna-xyz-infra-deploy-prod`; app-side IAM/deploy cutover remains pending. |
| `hasna-internalapps-prod-media-789877399345` | `us-east-1` | Existing internal app media bucket. Legacy naming. |
| `hasna-internalapps-tfstate-789877399345` | `us-east-1` | Existing Terraform state bucket. Current state and all source versions copied to `hasna-xyz-infra-tfstate-prod`; app-side backend migration remains pending. |
| `hasna-xyz-prod-emails` | `us-west-2` | Existing email bucket plus partial Drive copy under `drive/`. Legacy naming. |
| `hasna-xyz-prod-files` | `us-east-1` | Current Google Drive source of record under `google-drive/`. Legacy naming. |

Execution update on 2026-06-07:

- Created the first canonical Terraform-managed S3 batch in `hasna-xyz-infra`:
  54 `hasna-xyz-opensource-{app}-prod` buckets plus 5
  `hasna-xyz-infra-{purpose}-prod` buckets.
- Terraform state was migrated to
  `s3://hasna-xyz-infra-tfstate-prod/hasna-xyz/s3-buckets/terraform.tfstate`.
- Terraform state locking uses DynamoDB table
  `hasna-xyz-infra-terraform-locks-prod` with on-demand billing, SSE, and
  point-in-time recovery enabled.
- Post-apply Terraform plan returned no changes.
- `hasna-xyz-opensource-files-prod` has versioning, public access block,
  SSE-S3 encryption, lifecycle rules, bucket-owner-enforced ownership, and daily
  S3 inventory to `hasna-xyz-infra-inventory-prod`.
- Copied the full legacy Google Drive archive from
  `s3://hasna-xyz-prod-files/google-drive/` into
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/raw/`.
  Final source and target totals both showed 18,212 objects and
  132,917,143,313 bytes.
- Legacy buckets remain readable and have not been migrated or retired.

Google Drive archive findings:

| Location | Objects | Bytes | Status |
| --- | ---: | ---: | --- |
| `s3://hasna-xyz-prod-files/google-drive/` | 18,212 | 132,917,143,313 | Current full archive/source of record. |
| `s3://hasna-xyz-prod-emails/drive/` | 128 | 348,381,076 | Partial only. |
| `s3://hasna-xyz-prod-files/andreihasnacom/` | 44 | 248,531,483 | Partial only. |
| `s3://hasna-backup-googledrive/My Drive/` in base `hasna` account | 5,811 | 49,593,902,986 | Older backup. |
| `s3://hasna-backup-googledrive/Shared Drives/` in base `hasna` account | 11,656 | 82,637,104,647 | Older backup. |

`open-files` runtime mismatch found on `spark02`:

- Active S3 source row `src_p8WUDEpmRP` is named `prod-emails-drive` and points
  at `s3://hasna-xyz-prod-emails/drive` in region `us-west-2`.
- The same source row has `file_count=18212`, and the DB has 18,212 active
  `files` rows plus 18,212 active `google_drive_imported_objects` rows for
  Google Drive destination `src_p8WUDEpmRP`.
- Those DB rows use storage keys under `google-drive/...`, matching
  `s3://hasna-xyz-prod-files/google-drive/...`, not the configured
  `hasna-xyz-prod-emails/drive` source.
- AWS verification:
  `hasna-xyz-prod-emails/drive/` has only 128 objects and 348,381,076 bytes,
  while `hasna-xyz-prod-files/google-drive/` has 18,212 objects and
  132,917,143,313 bytes.
- `hasna-xyz-opensource-files-prod` now contains the raw copied archive under
  `imports/google-drive/legacy-s3-2026-06-07/raw/`, and canonical
  `objects/sha256/...` promotion is complete by uploaded result manifests. The
  app has not been cut over yet.

Canonical object promotion update on 2026-06-08:

- Added migration utility `scripts/google-drive-canonicalize.ts`.
- Generated a promotion manifest from the live SQLite metadata:
  18,212 rows, 132,917,143,313 bytes, 31 zero-byte rows, 18,211 rows that can
  be promoted with single S3 `CopyObject`, and 1 oversized 19,344,300,537-byte
  object requiring a separate large-object path. The single-copy batches and
  large-object path have all completed; dedicated task `2e24780a` is closed.
- Uploaded manifest:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-manifest-2026-06-08T03-21-42-019Z.jsonl`.
- Verified the old `hash` values are not canonical SHA-256 values. They are
  Google Drive MD5 values for normal binary files and BLAKE3 values for exported
  Google Workspace files, so `objects/sha256/...` must be based on checksums
  computed from S3 object bytes.
- Ran a 50-row promotion pilot for the smallest rows. Because of content
  dedupe, this created 2 canonical objects under `objects/sha256/...`:
  the empty object and one 70-byte object. S3 head checks with checksum mode
  confirmed both have full-object SHA-256 checksums and migration metadata.
- Ran the next 500-row promotion batch:
  `bun scripts/google-drive-canonicalize.ts promote --offset 50 --limit 500 --max-size 1048576 --result-out /home/hasna/.hasna/files/google-drive-promotion-results-2026-06-08-offset50-limit500.jsonl --result-upload`.
  Result: 500 selected, 347 newly promoted canonical objects, 153
  already-present/deduped rows, 0 skipped oversized rows, 0 errors, and 767,772
  selected bytes.
- Uploaded the batch result:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-results-2026-06-08T03-26-21-197Z.jsonl`.
  The local result file has 501 JSONL lines, and the uploaded S3 object is
  `application/x-ndjson` with metadata `run-id=2026-06-08T03-26-21-197Z`,
  `selected=500`, and `source=google-drive-canonicalize`.
- Verified the canonical prefix after the 50-row pilot plus 500-row batch:
  349 objects under `objects/sha256/...`, 767,842 bytes total. Verified
  `tmp/google-drive-sha256/` is empty after the batch.
- Ran the next 1,000-row promotion batch:
  `bun scripts/google-drive-canonicalize.ts promote --offset 550 --limit 1000 --max-size 1048576 --result-out /home/hasna/.hasna/files/google-drive-promotion-results-2026-06-08-offset550-limit1000.jsonl --result-upload`.
  Result: 1,000 selected, 928 newly promoted canonical objects, 72
  already-present/deduped rows, 0 skipped oversized rows, 0 errors, and
  7,693,595 selected bytes.
- Uploaded the batch result:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-results-2026-06-08T03-35-24-297Z.jsonl`.
  The local result file has 1,001 JSONL lines, and the uploaded S3 object is
  `application/x-ndjson` with metadata `run-id=2026-06-08T03-35-24-297Z`,
  `selected=1000`, and `source=google-drive-canonicalize`.
- Verified the canonical prefix after the 50-row pilot, 500-row batch, and
  1,000-row batch: 1,277 objects under `objects/sha256/...`, 8,461,437 bytes
  total. Verified `tmp/google-drive-sha256/` is empty after the batch.
- Ran the next 1,000-row promotion batch:
  `bun scripts/google-drive-canonicalize.ts promote --offset 1550 --limit 1000 --max-size 1048576 --result-out /home/hasna/.hasna/files/google-drive-promotion-results-2026-06-08-offset1550-limit1000.jsonl --result-upload`.
  Result: 1,000 selected, 882 newly promoted canonical objects, 118
  already-present/deduped rows, 0 skipped oversized rows, 0 errors, and
  14,796,400 selected bytes.
- Uploaded the batch result:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-results-2026-06-08T03-51-49-222Z.jsonl`.
  The local result file has 1,001 JSONL lines, and the uploaded S3 object is
  `application/x-ndjson` with metadata `run-id=2026-06-08T03-51-49-222Z`,
  `selected=1000`, and `source=google-drive-canonicalize`.
- Verified the canonical prefix after the 50-row pilot and three batches:
  2,159 objects under `objects/sha256/...`, 23,257,837 bytes total. Verified
  `tmp/google-drive-sha256/` is empty after the batch.
- Ran the next 1,000-row promotion batch:
  `bun scripts/google-drive-canonicalize.ts promote --offset 2550 --limit 1000 --max-size 1048576 --result-out /home/hasna/.hasna/files/google-drive-promotion-results-2026-06-08-offset2550-limit1000.jsonl --result-upload`.
  Result: 1,000 selected, 943 newly promoted canonical objects, 57
  already-present/deduped rows, 0 skipped oversized rows, 0 errors, and
  29,891,657 selected bytes.
- Uploaded the batch result:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-results-2026-06-08T04-05-43-818Z.jsonl`.
  The local result file has 1,001 JSONL lines, and the uploaded S3 object is
  `application/x-ndjson` with metadata `run-id=2026-06-08T04-05-43-818Z`,
  `selected=1000`, and `source=google-drive-canonicalize`.
- Verified the canonical prefix after the 50-row pilot and four batches:
  3,102 objects under `objects/sha256/...`, 53,149,494 bytes total. Verified
  `tmp/google-drive-sha256/` is empty after the batch.
- Ran the next 1,000-row promotion batch:
  `bun scripts/google-drive-canonicalize.ts promote --offset 3550 --limit 1000 --max-size 1048576 --result-out /home/hasna/.hasna/files/google-drive-promotion-results-2026-06-08-offset3550-limit1000.jsonl --result-upload`.
  Result: 1,000 selected, 884 newly promoted canonical objects, 116
  already-present/deduped rows, 0 skipped oversized rows, 0 errors, and
  42,787,583 selected bytes.
- Uploaded the batch result:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-results-2026-06-08T07-38-12-465Z.jsonl`.
  The local result file has 1,001 JSONL lines, and the uploaded S3 object is
  `application/x-ndjson` with metadata `run-id=2026-06-08T07-38-12-465Z`,
  `selected=1000`, and `source=google-drive-canonicalize`.
- Verified the canonical prefix after the 50-row pilot and five batches:
  3,986 objects under `objects/sha256/...`, 95,937,077 bytes total. Verified
  `tmp/google-drive-sha256/` is empty after the batch.
- Ran the next 1,000-row promotion batch:
  `bun scripts/google-drive-canonicalize.ts promote --offset 4550 --limit 1000 --max-size 1048576 --result-out /home/hasna/.hasna/files/google-drive-promotion-results-2026-06-08-offset4550-limit1000.jsonl --result-upload`.
  Result: 1,000 selected, 842 newly promoted canonical objects, 158
  already-present/deduped rows, 0 skipped oversized rows, 0 errors, and
  62,310,241 selected bytes.
- Uploaded the batch result:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-results-2026-06-08T07-52-29-985Z.jsonl`.
  The local result file has 1,001 JSONL lines, and the uploaded S3 object is
  `application/x-ndjson` with metadata `run-id=2026-06-08T07-52-29-985Z`,
  `selected=1000`, and `source=google-drive-canonicalize`.
- Verified the canonical prefix after the 50-row pilot and six batches:
  4,828 objects under `objects/sha256/...`, 158,247,318 bytes total. Verified
  `tmp/google-drive-sha256/` is empty after the batch.
- Ran the next 1,000-row promotion batch:
  `bun scripts/google-drive-canonicalize.ts promote --offset 5550 --limit 1000 --max-size 1048576 --result-out /home/hasna/.hasna/files/google-drive-promotion-results-2026-06-08-offset5550-limit1000.jsonl --result-upload`.
  Result: 1,000 selected, 875 newly promoted canonical objects, 125
  already-present/deduped rows, 0 skipped oversized rows, 0 errors, and
  96,548,518 selected bytes.
- Uploaded the batch result:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-results-2026-06-08T08-09-49-374Z.jsonl`.
  The local result file has 1,001 JSONL lines, and the uploaded S3 object is
  `application/x-ndjson` with metadata `run-id=2026-06-08T08-09-49-374Z`,
  `selected=1000`, and `source=google-drive-canonicalize`.
- Verified the canonical prefix after the 50-row pilot and seven batches:
  5,703 objects under `objects/sha256/...`, 254,795,836 bytes total. Verified
  `tmp/google-drive-sha256/` is empty after the batch.
- Ran the next 1,000-row promotion batch:
  `bun scripts/google-drive-canonicalize.ts promote --offset 6550 --limit 1000 --max-size 1048576 --result-out /home/hasna/.hasna/files/google-drive-promotion-results-2026-06-08-offset6550-limit1000.jsonl --result-upload`.
  Result: 1,000 selected, 818 newly promoted canonical objects, 182
  already-present/deduped rows, 0 skipped oversized rows, 0 errors, and
  139,665,770 selected bytes.
- Uploaded the batch result:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-results-2026-06-08T08-25-30-531Z.jsonl`.
  The local result file has 1,001 JSONL lines, and the uploaded S3 object is
  `application/x-ndjson` with metadata `run-id=2026-06-08T08-25-30-531Z`,
  `selected=1000`, and `source=google-drive-canonicalize`.
- Verified the canonical prefix after the 50-row pilot and eight batches:
  6,521 objects under `objects/sha256/...`, 394,461,606 bytes total. Verified
  `tmp/google-drive-sha256/` is empty after the batch.
- Ran the next 1,000-row promotion batch:
  `bun scripts/google-drive-canonicalize.ts promote --offset 7550 --limit 1000 --max-size 1048576 --result-out /home/hasna/.hasna/files/google-drive-promotion-results-2026-06-08-offset7550-limit1000.jsonl --result-upload`.
  Result: 1,000 selected, 778 newly promoted canonical objects, 222
  already-present/deduped rows, 0 skipped oversized rows, 0 errors, and
  189,980,130 selected bytes.
- Uploaded the batch result:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-results-2026-06-08T08-40-25-050Z.jsonl`.
  The local result file has 1,001 JSONL lines, and the uploaded S3 object is
  `application/x-ndjson` with metadata `run-id=2026-06-08T08-40-25-050Z`,
  `selected=1000`, and `source=google-drive-canonicalize`.
- Verified the canonical prefix after the 50-row pilot and nine batches:
  7,299 objects under `objects/sha256/...`, 584,441,736 bytes total. Verified
  `tmp/google-drive-sha256/` is empty after the batch.
- Ran the next 1,000-row promotion batch:
  `bun scripts/google-drive-canonicalize.ts promote --offset 8550 --limit 1000 --max-size 1048576 --result-out /home/hasna/.hasna/files/google-drive-promotion-results-2026-06-08-offset8550-limit1000.jsonl --result-upload`.
  Result: 1,000 selected, 778 newly promoted canonical objects, 222
  already-present/deduped rows, 0 skipped oversized rows, 0 errors, and
  261,121,740 selected bytes.
- Uploaded the batch result:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-results-2026-06-08T08-54-14-862Z.jsonl`.
  The local result file has 1,001 JSONL lines, and the uploaded S3 object is
  `application/x-ndjson` with metadata `run-id=2026-06-08T08-54-14-862Z`,
  `selected=1000`, and `source=google-drive-canonicalize`.
- Verified the canonical prefix after the 50-row pilot and ten batches:
  8,077 objects under `objects/sha256/...`, 845,563,476 bytes total. Verified
  `tmp/google-drive-sha256/` is empty after the batch.
- Ran the next 1,000-row promotion batch:
  `bun scripts/google-drive-canonicalize.ts promote --offset 9550 --limit 1000 --max-size 1048576 --result-out /home/hasna/.hasna/files/google-drive-promotion-results-2026-06-08-offset9550-limit1000.jsonl --result-upload`.
  Result: 1,000 selected, 654 newly promoted canonical objects, 346
  already-present/deduped rows, 0 skipped oversized rows, 0 errors, and
  332,691,575 selected bytes.
- Uploaded the batch result:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-results-2026-06-08T09-08-04-688Z.jsonl`.
  The local result file has 1,001 JSONL lines, and the uploaded S3 object is
  `application/x-ndjson` with metadata `run-id=2026-06-08T09-08-04-688Z`,
  `selected=1000`, and `source=google-drive-canonicalize`.
- Verified the canonical prefix after the 50-row pilot and eleven batches:
  8,731 objects under `objects/sha256/...`, 1,178,255,051 bytes total. Verified
  `tmp/google-drive-sha256/` is empty after the batch.
- Ran the next 1,000-row promotion batch:
  `bun scripts/google-drive-canonicalize.ts promote --offset 10550 --limit 1000 --max-size 1048576 --result-out /home/hasna/.hasna/files/google-drive-promotion-results-2026-06-08-offset10550-limit1000.jsonl --result-upload`.
  Result: 1,000 selected, 765 newly promoted canonical objects, 235
  already-present/deduped rows, 0 skipped oversized rows, 0 errors, and
  618,768,006 selected bytes.
- Uploaded the batch result:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-results-2026-06-08T09-22-28-762Z.jsonl`.
  The local result file has 1,001 JSONL lines, and the uploaded S3 object is
  `application/x-ndjson` with metadata `run-id=2026-06-08T09-22-28-762Z`,
  `selected=1000`, and `source=google-drive-canonicalize`.
- Verified the canonical prefix after the 50-row pilot and twelve batches:
  9,496 objects under `objects/sha256/...`, 1,797,023,057 bytes total. Verified
  `tmp/google-drive-sha256/` is empty after the batch.
- Ran the final `<=1MiB` tail promotion batch:
  `bun scripts/google-drive-canonicalize.ts promote --offset 11550 --limit 1000 --max-size 1048576 --result-out /home/hasna/.hasna/files/google-drive-promotion-results-2026-06-08-offset11550-limit1000.jsonl --result-upload`.
  Result: 63 selected, 58 newly promoted canonical objects, 5
  already-present/deduped rows, 0 skipped oversized rows, 0 errors, and
  60,079,931 promoted-byte counter.
- Uploaded the tail batch result:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-results-2026-06-08T09-37-57-431Z.jsonl`.
  The local result file has 64 JSONL lines, and the uploaded S3 object is
  `application/x-ndjson` with metadata `run-id=2026-06-08T09-37-57-431Z`,
  `selected=63`, and `source=google-drive-canonicalize`.
- Verified the canonical prefix after the complete `<=1MiB` phase:
  9,554 objects under `objects/sha256/...`, 1,857,102,988 bytes total. Verified
  `tmp/google-drive-sha256/` is empty after the batch. The promotion utility does
  not mutate SQLite; local DB metadata cutover is still tracked as a separate
  migration task.
- Ran the first `>1MiB` to `<=5MiB` promotion window:
  `bun scripts/google-drive-canonicalize.ts promote --offset 11613 --limit 1000 --max-size 5242880 --result-out /home/hasna/.hasna/files/google-drive-promotion-results-2026-06-08-offset11613-limit1000-max5mib.jsonl --result-upload`.
  Result: 1,000 selected, 790 newly promoted canonical objects, 210
  already-present/deduped rows, 0 skipped oversized rows, 0 errors, and
  943,604,581 promoted-byte counter.
- Uploaded the first `<=5MiB` batch result:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-results-2026-06-08T09-43-14-700Z.jsonl`.
  The local result file has 1,001 JSONL lines, and the uploaded S3 object is
  `application/x-ndjson` with metadata `run-id=2026-06-08T09-43-14-700Z`,
  `selected=1000`, and `source=google-drive-canonicalize`.
- Verified the canonical prefix after the first `<=5MiB` batch:
  10,344 objects under `objects/sha256/...`, 2,800,707,569 bytes total. Verified
  `tmp/google-drive-sha256/` is empty after the batch.
- Ran the second `>1MiB` to `<=5MiB` promotion window:
  `bun scripts/google-drive-canonicalize.ts promote --offset 12613 --limit 1000 --max-size 5242880 --result-out /home/hasna/.hasna/files/google-drive-promotion-results-2026-06-08-offset12613-limit1000-max5mib.jsonl --result-upload`.
  Result: 1,000 selected, 937 newly promoted canonical objects, 63
  already-present/deduped rows, 0 skipped oversized rows, 0 errors, and
  1,554,849,393 promoted-byte counter.
- Uploaded the second `<=5MiB` batch result:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-results-2026-06-08T10-01-04-090Z.jsonl`.
  The local result file has 1,001 JSONL lines, and the uploaded S3 object is
  `application/x-ndjson` with metadata `run-id=2026-06-08T10-01-04-090Z`,
  `selected=1000`, and `source=google-drive-canonicalize`.
- Verified the canonical prefix after the second `<=5MiB` batch:
  11,281 objects under `objects/sha256/...`, 4,355,556,962 bytes total. Verified
  `tmp/google-drive-sha256/` is empty after the batch.
- Ran the third `>1MiB` to `<=5MiB` promotion window:
  `bun scripts/google-drive-canonicalize.ts promote --offset 13613 --limit 1000 --max-size 5242880 --result-out /home/hasna/.hasna/files/google-drive-promotion-results-2026-06-08-offset13613-limit1000-max5mib.jsonl --result-upload`.
  Result: 1,000 selected, 966 newly promoted canonical objects, 34
  already-present/deduped rows, 0 skipped oversized rows, 0 errors, and
  2,398,436,712 promoted-byte counter.
- Uploaded the third `<=5MiB` batch result:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-results-2026-06-08T10-18-11-913Z.jsonl`.
  The local result file has 1,001 JSONL lines, and the uploaded S3 object is
  `application/x-ndjson` with metadata `run-id=2026-06-08T10-18-11-913Z`,
  `selected=1000`, and `source=google-drive-canonicalize`.
- Verified the canonical prefix after the third `<=5MiB` batch:
  12,247 objects under `objects/sha256/...`, 6,753,993,674 bytes total. Verified
  `tmp/google-drive-sha256/` is empty after the batch.
- Ran the fourth `>1MiB` to `<=5MiB` promotion window:
  `bun scripts/google-drive-canonicalize.ts promote --offset 14613 --limit 1000 --max-size 5242880 --result-out /home/hasna/.hasna/files/google-drive-promotion-results-2026-06-08-offset14613-limit1000-max5mib.jsonl --result-upload`.
  Result: 1,000 selected, 922 newly promoted canonical objects, 78
  already-present/deduped rows, 0 skipped oversized rows, 0 errors, and
  3,535,959,803 promoted-byte counter.
- Uploaded the fourth `<=5MiB` batch result:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-results-2026-06-08T10-36-17-142Z.jsonl`.
  The local result file has 1,001 JSONL lines, and the uploaded S3 object is
  `application/x-ndjson` with metadata `run-id=2026-06-08T10-36-17-142Z`,
  `selected=1000`, and `source=google-drive-canonicalize`.
- Verified the canonical prefix after the fourth `<=5MiB` batch:
  13,169 objects under `objects/sha256/...`, 10,289,953,477 bytes total.
  Verified `tmp/google-drive-sha256/` is empty after the batch.
- Ran the final `<=5MiB` tail:
  `bun scripts/google-drive-canonicalize.ts promote --offset 15613 --limit 1000 --max-size 5242880 --result-out /home/hasna/.hasna/files/google-drive-promotion-results-2026-06-08-offset15613-limit1000-max5mib.jsonl --result-upload`.
  Result: 85 selected, 76 newly promoted canonical objects, 9
  already-present/deduped rows, 0 skipped oversized rows, 0 errors, and
  389,837,752 promoted-byte counter.
- Uploaded the final `<=5MiB` tail result:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-results-2026-06-08T10-53-06-011Z.jsonl`.
  The local result file has 86 JSONL lines, and the uploaded S3 object is
  `application/x-ndjson` with metadata `run-id=2026-06-08T10-53-06-011Z`,
  `selected=85`, and `source=google-drive-canonicalize`.
- Verified the canonical prefix after the complete `<=5MiB` phase:
  13,245 objects under `objects/sha256/...`, 10,679,791,229 bytes total.
  Verified `tmp/google-drive-sha256/` is empty after the tail and no promotion
  or SSM process remained.
- Ran the first `>5MiB` to `<=25MiB` promotion-window batch:
  `bun scripts/google-drive-canonicalize.ts promote --min-size 5242881 --max-size 26214400 --offset 0 --limit 250 --result-out /home/hasna/.hasna/files/google-drive-promotion-results-2026-06-08-min5mib-max25mib-offset0-limit250.jsonl --result-upload`.
  Result: 250 selected, 237 newly promoted canonical objects, 13
  already-present/deduped rows, 0 skipped oversized rows, 0 errors, and
  1,379,313,192 promoted-byte counter.
- Uploaded the first `>5MiB` to `<=25MiB` batch result:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-results-2026-06-08T10-58-23-641Z.jsonl`.
  The local result file has 251 JSONL lines, and the uploaded S3 object is
  `application/x-ndjson` with metadata `run-id=2026-06-08T10-58-23-641Z`,
  `selected=250`, and `source=google-drive-canonicalize`.
- Verified the canonical prefix after the first `>5MiB` batch:
  13,482 objects under `objects/sha256/...`, 12,059,104,421 bytes total.
  Verified `tmp/google-drive-sha256/` is empty after the batch and no promotion
  or SSM process remained.
- Ran the second `>5MiB` to `<=25MiB` promotion-window batch:
  `bun scripts/google-drive-canonicalize.ts promote --min-size 5242881 --max-size 26214400 --offset 250 --limit 250 --result-out /home/hasna/.hasna/files/google-drive-promotion-results-2026-06-08-min5mib-max25mib-offset250-limit250.jsonl --result-upload`.
  Result: 250 selected, 227 newly promoted canonical objects, 23
  already-present/deduped rows, 0 skipped oversized rows, 0 errors, and
  1,511,520,530 promoted-byte counter.
- Uploaded the second `>5MiB` to `<=25MiB` batch result:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-results-2026-06-08T11-05-10-684Z.jsonl`.
  The local result file has 251 JSONL lines, and the uploaded S3 object summary
  row reports run ID `2026-06-08T11-05-10-684Z`, `selected=250`, and `errors=0`.
- Verified the canonical prefix after the second `>5MiB` batch:
  13,709 objects under `objects/sha256/...`, 13,570,624,951 bytes total.
  Verified `tmp/google-drive-sha256/` is empty after the batch and no promotion
  or SSM process remained.
- Ran the third `>5MiB` to `<=25MiB` promotion-window batch:
  `bun scripts/google-drive-canonicalize.ts promote --min-size 5242881 --max-size 26214400 --offset 500 --limit 250 --result-out /home/hasna/.hasna/files/google-drive-promotion-results-2026-06-08-min5mib-max25mib-offset500-limit250.jsonl --result-upload`.
  Result: 250 selected, 243 newly promoted canonical objects, 7
  already-present/deduped rows, 0 skipped oversized rows, 0 errors, and
  1,830,501,364 promoted-byte counter.
- Uploaded the third `>5MiB` to `<=25MiB` batch result:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-results-2026-06-08T11-13-46-276Z.jsonl`.
  The local result file has 251 JSONL lines, and the uploaded S3 object is
  `application/x-ndjson` with metadata `run-id=2026-06-08T11-13-46-276Z`,
  `selected=250`, and `source=google-drive-canonicalize`.
- Verified the canonical prefix after the third `>5MiB` batch:
  13,952 objects under `objects/sha256/...`, 15,401,126,315 bytes total.
  Verified `tmp/google-drive-sha256/` is empty after the batch and no promotion
  or SSM process remained.
- Ran the fourth `>5MiB` to `<=25MiB` promotion-window batch:
  `bun scripts/google-drive-canonicalize.ts promote --min-size 5242881 --max-size 26214400 --offset 750 --limit 250 --result-out /home/hasna/.hasna/files/google-drive-promotion-results-2026-06-08-min5mib-max25mib-offset750-limit250.jsonl --result-upload`.
  Result: 250 selected, 237 newly promoted canonical objects, 13
  already-present/deduped rows, 0 skipped oversized rows, 0 errors, and
  2,010,590,421 promoted-byte counter.
- Uploaded the fourth `>5MiB` to `<=25MiB` batch result:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-results-2026-06-08T11-20-55-756Z.jsonl`.
  The local result file has 251 JSONL lines, and the uploaded S3 object is
  `application/x-ndjson` with metadata `run-id=2026-06-08T11-20-55-756Z`,
  `selected=250`, and `source=google-drive-canonicalize`.
- Verified the canonical prefix after the fourth `>5MiB` batch:
  14,189 objects under `objects/sha256/...`, 17,411,716,736 bytes total.
  Verified `tmp/google-drive-sha256/` is empty after the batch and no promotion
  or SSM process remained.
- Ran the fifth `>5MiB` to `<=25MiB` promotion-window batch:
  `bun scripts/google-drive-canonicalize.ts promote --min-size 5242881 --max-size 26214400 --offset 1000 --limit 250 --result-out /home/hasna/.hasna/files/google-drive-promotion-results-2026-06-08-min5mib-max25mib-offset1000-limit250.jsonl --result-upload`.
  Result: 250 selected, 245 newly promoted canonical objects, 5
  already-present/deduped rows, 0 skipped oversized rows, 0 errors, and
  2,323,275,595 promoted-byte counter.
- Uploaded the fifth `>5MiB` to `<=25MiB` batch result:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-results-2026-06-08T11-27-54-512Z.jsonl`.
  The local result file has 251 JSONL lines, and the uploaded S3 object is
  `application/x-ndjson` with metadata `run-id=2026-06-08T11-27-54-512Z`,
  `selected=250`, and `source=google-drive-canonicalize`.
- Verified the canonical prefix after the fifth `>5MiB` batch:
  14,434 objects under `objects/sha256/...`, 19,734,992,331 bytes total.
  Verified `tmp/google-drive-sha256/` is empty after the batch and no promotion
  or SSM process remained.
- Ran the sixth `>5MiB` to `<=25MiB` promotion-window batch:
  `bun scripts/google-drive-canonicalize.ts promote --min-size 5242881 --max-size 26214400 --offset 1250 --limit 250 --result-out /home/hasna/.hasna/files/google-drive-promotion-results-2026-06-08-min5mib-max25mib-offset1250-limit250.jsonl --result-upload`.
  Result: 250 selected, 234 newly promoted canonical objects, 16
  already-present/deduped rows, 0 skipped oversized rows, 0 errors, and
  3,207,357,653 promoted-byte counter.
- Uploaded the sixth `>5MiB` to `<=25MiB` batch result:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-results-2026-06-08T11-35-31-402Z.jsonl`.
  The local result file has 251 JSONL lines, and the uploaded S3 object is
  `application/x-ndjson` with metadata `run-id=2026-06-08T11-35-31-402Z`,
  `selected=250`, and `source=google-drive-canonicalize`.
- Verified the canonical prefix after the sixth `>5MiB` batch:
  14,668 objects under `objects/sha256/...`, 22,942,349,984 bytes total.
  Verified `tmp/google-drive-sha256/` is empty after the batch and no promotion
  or SSM process remained.
- Ran the final `>5MiB` to `<=25MiB` promotion-window tail:
  `bun scripts/google-drive-canonicalize.ts promote --min-size 5242881 --max-size 26214400 --offset 1500 --limit 250 --result-out /home/hasna/.hasna/files/google-drive-promotion-results-2026-06-08-min5mib-max25mib-offset1500-limit250.jsonl --result-upload`.
  Result: 127 selected, 113 newly promoted canonical objects, 14
  already-present/deduped rows, 0 skipped oversized rows, 0 errors, and
  2,417,388,401 promoted-byte counter.
- Uploaded the final `>5MiB` to `<=25MiB` tail result:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-results-2026-06-08T11-43-29-838Z.jsonl`.
  The local result file has 128 JSONL lines, and the uploaded S3 object is
  `application/x-ndjson` with metadata `run-id=2026-06-08T11-43-29-838Z`,
  `selected=127`, and `source=google-drive-canonicalize`.
- Verified the canonical prefix after the complete `>5MiB` to `<=25MiB` phase:
  14,781 objects under `objects/sha256/...`, 25,359,738,385 bytes total.
  Verified `tmp/google-drive-sha256/` is empty after the tail and no promotion
  or SSM process remained. SQLite source counts confirm 1,627 rows with
  `5242880 < size <= 26214400` and 887 rows above `25MiB`, so result manifests
  now cover the complete medium-size window.
- Ran the first `>25MiB` to `<=50MiB` promotion-window batch:
  `bun scripts/google-drive-canonicalize.ts promote --min-size 26214401 --max-size 52428800 --offset 0 --limit 100 --result-out /home/hasna/.hasna/files/google-drive-promotion-results-2026-06-08-min25mib-max50mib-offset0-limit100.jsonl --result-upload`.
  Result: 100 selected, 97 newly promoted canonical objects, 3
  already-present/deduped rows, 0 skipped oversized rows, 0 errors, and
  3,066,906,461 promoted-byte counter.
- Uploaded the first `>25MiB` to `<=50MiB` batch result:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-results-2026-06-08T11-49-42-186Z.jsonl`.
  The local result file has 101 JSONL lines, and the uploaded S3 object is
  `application/x-ndjson` with metadata `run-id=2026-06-08T11-49-42-186Z`,
  `selected=100`, and `source=google-drive-canonicalize`.
- Verified the canonical prefix after the first `>25MiB` batch:
  14,878 objects under `objects/sha256/...`, 28,426,644,846 bytes total.
  Verified `tmp/google-drive-sha256/` is empty after the batch and no promotion
  or SSM process remained.
- Ran the second `>25MiB` to `<=50MiB` promotion-window batch:
  `bun scripts/google-drive-canonicalize.ts promote --min-size 26214401 --max-size 52428800 --offset 100 --limit 100 --result-out /home/hasna/.hasna/files/google-drive-promotion-results-2026-06-08-min25mib-max50mib-offset100-limit100.jsonl --result-upload`.
  Result: 100 selected, 100 newly promoted canonical objects, 0
  already-present/deduped rows, 0 skipped oversized rows, 0 errors, and
  4,553,662,814 promoted-byte counter.
- Uploaded the second `>25MiB` to `<=50MiB` batch result:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-results-2026-06-08T11-56-05-782Z.jsonl`.
  The local result file has 101 JSONL lines, and the uploaded S3 object is
  `application/x-ndjson` with metadata `run-id=2026-06-08T11-56-05-782Z`,
  `selected=100`, and `source=google-drive-canonicalize`.
- Verified the canonical prefix after the second `>25MiB` batch:
  14,978 objects under `objects/sha256/...`, 32,980,307,660 bytes total.
  Verified `tmp/google-drive-sha256/` is empty after the batch and no promotion
  or SSM process remained.
- Ran the third `>25MiB` to `<=50MiB` promotion-window batch:
  `bun scripts/google-drive-canonicalize.ts promote --min-size 26214401 --max-size 52428800 --offset 200 --limit 100 --result-out /home/hasna/.hasna/files/google-drive-promotion-results-2026-06-08-min25mib-max50mib-offset200-limit100.jsonl --result-upload`.
  Result: 100 selected, 100 newly promoted canonical objects, 0
  already-present/deduped rows, 0 skipped oversized rows, 0 errors, and
  4,903,069,696 promoted-byte counter.
- Uploaded the third `>25MiB` to `<=50MiB` batch result:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-results-2026-06-08T14-04-58-414Z.jsonl`.
  The local result file has 101 JSONL lines, and the uploaded S3 object is
  `application/x-ndjson` with metadata `run-id=2026-06-08T14-04-58-414Z`,
  `selected=100`, and `source=google-drive-canonicalize`.
- Verified the canonical prefix after the third `>25MiB` batch:
  15,078 objects under `objects/sha256/...`, 37,883,377,356 bytes total.
  Verified `tmp/google-drive-sha256/` is empty after the batch and no promotion
  process remained.
- Ran the fourth `>25MiB` to `<=50MiB` promotion-window batch:
  `bun scripts/google-drive-canonicalize.ts promote --min-size 26214401 --max-size 52428800 --offset 300 --limit 100 --result-out /home/hasna/.hasna/files/google-drive-promotion-results-2026-06-08-min25mib-max50mib-offset300-limit100.jsonl --result-upload`.
  Result: 100 selected, 99 newly promoted canonical objects, 1
  already-present/deduped row, 0 skipped oversized rows, 0 errors, and
  4,858,544,640 promoted-byte counter.
- Uploaded the fourth `>25MiB` to `<=50MiB` batch result:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-results-2026-06-08T14-17-04-861Z.jsonl`.
  The local result file has 101 JSONL lines, and the uploaded S3 object is
  `application/x-ndjson` with metadata `run-id=2026-06-08T14-17-04-861Z`,
  `selected=100`, and `source=google-drive-canonicalize`.
- Verified the canonical prefix after the fourth `>25MiB` batch:
  15,177 objects under `objects/sha256/...`, 42,741,921,996 bytes total.
  Verified `tmp/google-drive-sha256/` is empty after the batch and no promotion
  process remained.
- Ran the final `>25MiB` to `<=50MiB` promotion-window tail:
  `bun scripts/google-drive-canonicalize.ts promote --min-size 26214401 --max-size 52428800 --offset 400 --limit 250 --result-out /home/hasna/.hasna/files/google-drive-promotion-results-2026-06-08-min25mib-max50mib-offset400-limit250.jsonl --result-upload`.
  Result: 222 selected, 219 newly promoted canonical objects, 3
  already-present/deduped rows, 0 skipped oversized rows, 0 errors, and
  10,816,355,818 promoted-byte counter.
- Uploaded the final `>25MiB` to `<=50MiB` tail result:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-results-2026-06-08T14-25-08-931Z.jsonl`.
  The local result file has 223 JSONL lines, and the uploaded S3 object is
  `application/x-ndjson` with metadata `run-id=2026-06-08T14-25-08-931Z`,
  `selected=222`, and `source=google-drive-canonicalize`.
- Verified the canonical prefix after the complete `>25MiB` to `<=50MiB`
  phase: 15,396 objects under `objects/sha256/...`, 53,558,277,814 bytes
  total. Verified `tmp/google-drive-sha256/` is empty after the tail and no
  promotion process remained. SQLite source counts confirm 622 rows with
  `26214400 < size <= 52428800` and 265 rows above `50MiB`, so result manifests
  now cover the complete `>25MiB` to `<=50MiB` window.
- Ran the complete `>50MiB` to `<=100MiB` promotion-window batch:
  `bun scripts/google-drive-canonicalize.ts promote --min-size 52428801 --max-size 104857600 --offset 0 --limit 150 --result-out /home/hasna/.hasna/files/google-drive-promotion-results-2026-06-08-min50mib-max100mib-offset0-limit150.jsonl --result-upload`.
  Result: 133 selected, 128 newly promoted canonical objects, 5
  already-present/deduped rows, 0 skipped oversized rows, 0 errors, and
  9,286,798,006 promoted-byte counter.
- Uploaded the `>50MiB` to `<=100MiB` batch result:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-results-2026-06-08T14-41-45-541Z.jsonl`.
  The local result file has 134 JSONL lines, and the uploaded S3 object is
  `application/x-ndjson` with metadata `run-id=2026-06-08T14-41-45-541Z`,
  `selected=133`, and `source=google-drive-canonicalize`.
- Verified the canonical prefix after the complete `>50MiB` to `<=100MiB`
  phase: 15,524 objects under `objects/sha256/...`, 62,845,075,820 bytes
  total. Verified `tmp/google-drive-sha256/` is empty after the batch and no
  promotion process remained. SQLite source counts confirm 133 rows with
  `52428800 < size <= 104857600` and 132 rows above `100MiB`, so result
  manifests now cover the complete `>50MiB` to `<=100MiB` window.
- Ran the complete `>100MiB` to `<=250MiB` promotion-window batch:
  `bun scripts/google-drive-canonicalize.ts promote --min-size 104857601 --max-size 262144000 --offset 0 --limit 100 --result-out /home/hasna/.hasna/files/google-drive-promotion-results-2026-06-08-min100mib-max250mib-offset0-limit100.jsonl --result-upload`.
  Result: 91 selected, 85 newly promoted canonical objects, 6
  already-present/deduped rows, 0 skipped oversized rows, 0 errors, and
  15,539,662,051 promoted-byte counter.
- Uploaded the `>100MiB` to `<=250MiB` batch result:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-results-2026-06-08T14-54-10-108Z.jsonl`.
  The local result file has 92 JSONL lines, and the uploaded S3 object is
  `application/x-ndjson` with metadata `run-id=2026-06-08T14-54-10-108Z`,
  `selected=91`, and `source=google-drive-canonicalize`.
- Verified the canonical prefix after the complete `>100MiB` to `<=250MiB`
  phase: 15,609 objects under `objects/sha256/...`, 78,384,737,871 bytes
  total. Verified `tmp/google-drive-sha256/` is empty after the batch and no
  promotion process remained. SQLite source counts confirm 91 rows with
  `104857600 < size <= 262144000` and 41 rows above `250MiB`, so result
  manifests now cover the complete `>100MiB` to `<=250MiB` window.
- Ran the complete `>250MiB` to `<=1GiB` promotion-window batch:
  `bun scripts/google-drive-canonicalize.ts promote --min-size 262144001 --max-size 1073741824 --offset 0 --limit 40 --result-out /home/hasna/.hasna/files/google-drive-promotion-results-2026-06-08-min250mib-max1gib-offset0-limit40.jsonl --result-upload`.
  Result: 31 selected, 29 newly promoted canonical objects, 2
  already-present/deduped rows, 0 skipped oversized rows, 0 errors, and
  13,682,064,593 promoted-byte counter.
- Uploaded the `>250MiB` to `<=1GiB` batch result:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-results-2026-06-08T15-15-47-280Z.jsonl`.
  The local result file has 32 JSONL lines, and the uploaded S3 object is
  `application/x-ndjson` with metadata `run-id=2026-06-08T15-15-47-280Z`,
  `selected=31`, and `source=google-drive-canonicalize`.
- Verified the canonical prefix after the complete `>250MiB` to `<=1GiB`
  phase: 15,638 objects under `objects/sha256/...`, 92,066,802,464 bytes
  total. Verified `tmp/google-drive-sha256/` is empty after the batch and no
  promotion process remained. SQLite source counts confirm 31 rows with
  `262144000 < size <= 1073741824` and 10 rows above `1GiB`, so result
  manifests now cover the complete `>250MiB` to `<=1GiB` window.
- Ran the complete `>1GiB` to `<=5GiB` promotion-window batch:
  `bun scripts/google-drive-canonicalize.ts promote --min-size 1073741825 --max-size 5368709120 --offset 0 --limit 20 --result-out /home/hasna/.hasna/files/google-drive-promotion-results-2026-06-08-min1gib-max5gib-offset0-limit20.jsonl --result-upload`.
  Result: 9 selected, 9 newly promoted canonical objects, 0
  already-present/deduped rows, 0 skipped oversized rows, 0 errors, and
  16,947,339,513 promoted-byte counter.
- Uploaded the `>1GiB` to `<=5GiB` batch result:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-results-2026-06-08T15-38-14-293Z.jsonl`.
  The local result file has 10 JSONL lines, and the uploaded S3 object is
  `application/x-ndjson` with metadata `run-id=2026-06-08T15-38-14-293Z`,
  `selected=9`, and `source=google-drive-canonicalize`.
- Verified the canonical prefix after the complete `>1GiB` to `<=5GiB`
  phase: 15,647 objects under `objects/sha256/...`, 109,014,141,977 bytes
  total. Verified `tmp/google-drive-sha256/` is empty after the batch and no
  promotion process remained. SQLite source counts confirm 9 rows with
  `1073741824 < size <= 5368709120` and 1 row above `5GiB`, so result
  manifests now cover the complete `>1GiB` to `<=5GiB` window.
- Added and typechecked an explicit large-object promotion path in
  `scripts/google-drive-canonicalize.ts`: `--large-object` computes the real
  content SHA-256 by streaming the raw S3 object, then uses S3 multipart copy
  to place the object at the canonical SHA-derived key without writing a 19GB
  local temp file.
- Ran the known `>5GiB` Drive object through that large-object path:
  `bun scripts/google-drive-canonicalize.ts promote --min-size 5368709121 --max-size 30000000000 --offset 0 --limit 1 --large-object --result-out /home/hasna/.hasna/files/google-drive-promotion-results-2026-06-08-min5gib-max30gb-offset0-limit1-large.jsonl --result-upload`.
  Result: 1 selected, 1 promoted large canonical object, 0 skipped oversized
  rows, 0 errors, and 19,344,300,537 promoted-byte counter.
- Uploaded the `>5GiB` batch result:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-results-2026-06-08T16-05-32-915Z.jsonl`.
  The local result file has 2 JSONL lines, and the uploaded S3 object is
  `application/x-ndjson` with metadata `run-id=2026-06-08T16-05-32-915Z`,
  `selected=1`, and `source=google-drive-canonicalize`.
- Verified the promoted large object:
  `objects/sha256/4e/10/4e108c977a1cd76f2c26881f11e30d22d017ea7b512936c0a216743c14f7d91a`.
  The final object is 19,344,300,537 bytes, `ContentType=video/mp4`, encrypted
  with `AES256`, and has metadata `sha256=4e108c977a1cd76f2c26881f11e30d22d017ea7b512936c0a216743c14f7d91a`,
  `file-record-id=f_9BdHQJGCPN`, `drive-file-id=1Ei2Cd8j2_mUOWE_Ef-3iVGap0eTAj6LY`,
  and `legacy-hash-kind=md5`.
- Verified the canonical prefix after the large-object phase: 15,648 objects
  under `objects/sha256/...`, 128,358,442,514 bytes total. Verified
  `tmp/google-drive-sha256/` is empty, no incomplete multipart upload remains,
  and no promotion process remained. Result manifests now cover all 18,212
  Drive import rows; dedupe means the canonical layout contains 15,648 unique
  content-addressed objects.
- Rechecked uploaded result coverage on 2026-06-08 after the large-object
  phase. The uploaded result set initially covered 18,162 unique
  `file_record_id` values because the first 50-row pilot had not been uploaded.
  Re-ran that exact `--offset 0 --limit 50` range idempotently and uploaded:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/promotion-results-2026-06-08T17-03-10-607Z.jsonl`.
  The rerun selected 50 rows, found all 50 `already_present`, and had 0 errors.
  Final row-level coverage: 18,212 manifest rows, 18,212 unique non-summary
  result rows, `manifest_minus_covered=0`, `covered_not_manifest=0`, and
  `summary_errors=0`.
- Added a `mapping` command to `scripts/google-drive-canonicalize.ts` and
  generated the Postgres import input:
  `/home/hasna/.hasna/files/google-drive-canonical-object-mapping-2026-06-08.jsonl`.
  Uploaded mapping artifact:
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/legacy-s3-2026-06-07/manifests/canonical-object-mapping-2026-06-08T17-05-46-833Z.jsonl`.
  Verification: 18,212 mapping rows, 18,212 `mapped`, 0 missing, 0 mismatched,
  0 result errors. The uploaded object is `application/x-ndjson`, encrypted
  with `AES256`, and has metadata `manifest-rows=18212` and
  `mapped-rows=18212`.
- Added an idempotent Postgres metadata import path:
  `files storage import-google-drive --mapping-file /home/hasna/.hasna/files/google-drive-canonical-object-mapping-2026-06-08.jsonl`.
  The command pushes the local SQLite storage tables to Postgres, then applies
  the canonical Drive mapping to `google_drive_imported_objects` by
  `file_record_id`. It sets `raw_bucket`, `raw_key`, `canonical_bucket`,
  `canonical_key`, `canonical_sha256`, `promotion_action`, `promotion_status`,
  and updates `storage_key` to the canonical object key in Postgres. It does
  not mutate the local SQLite source database.
- Ran the Postgres metadata import through an SSM tunnel to
  `hasna-xyz-infra-apps-prod-postgres` on 2026-06-08. Import result:
  `machines` 1/1, `sources` 6/6, `files` 18,212/18,212,
  `google_drive_sync_state` 1/1, `google_drive_imported_objects`
  18,212/18,212, and mapping rows 18,212/18,212 with 0 missing in Postgres.
  Direct Postgres verification returned `files=18212`, `drive_imports=18212`,
  `drive_mapped=18212`, `drive_missing_mapping=0`, and
  `distinct_canonical_keys=15648`. The `files.size` Postgres column was widened
  to `BIGINT` during this run so the 19,344,300,537-byte Drive object can be
  represented. The large row `f_9BdHQJGCPN` maps to canonical key
  `objects/sha256/4e/10/4e108c977a1cd76f2c26881f11e30d22d017ea7b512936c0a216743c14f7d91a`.
  A storage status smoke with the canonical RDS URL and
  `HASNA_FILES_S3_BUCKET=hasna-xyz-opensource-files-prod` reported hybrid mode,
  remote metadata configured, and the expected local table counts.

Do not cut `open-files` over to the canonical bucket until review workflow
bootstrap, app smoke tests, and rollback documentation are complete.

Local machine checks:

- `spark01`: no local 133 GB Drive archive found; only local app DB/state.
- `apple03`: `~/.hasna/files/files.db` exists but file/source/import tables are
  empty; no archive found except an isolated project file.

## Target Bucket Policy

All production app buckets should be created in `hasna-xyz-infra` unless a
regulatory or latency requirement says otherwise.

Defaults:

- Region: `us-east-1` for new Hasna XYZ app buckets.
- Versioning: enabled.
- Public access block: enabled.
- Object ownership: bucket owner enforced.
- Encryption: SSE-S3 initially; move to KMS per app when compliance requires it.
- Lifecycle:
  - abort incomplete multipart uploads after 7 days;
  - expire temporary upload/export prefixes;
  - retain canonical objects until app policy says otherwise.
- Inventory: enabled for `open-files` and any high-volume bucket.
- Tags:
  `Owner=hasna`, `Division=xyz`, `AppType`, `App`, `Environment=prod`,
  `ManagedBy=terraform`, `DataClass`, and `Legacy=false`.

## Open Files Bucket Layout

Target bucket: `hasna-xyz-opensource-files-prod`.

`open-files` should not use visible folder paths as final object keys. To fully
replace Google Drive, folder paths, profiles, owners, permissions, labels,
collections, comments, shared-drive IDs, and original Google Drive IDs belong in
the database. S3 stores immutable bytes and operational artifacts.

Recommended prefixes:

```txt
uploads/quarantine/{yyyy}/{mm}/{upload_intent_id}/{original_filename}
objects/sha256/{aa}/{bb}/{sha256}
previews/{asset_id}/{version_id}/{preview_kind}/{filename}
thumbnails/{asset_id}/{version_id}/{size}.webp
imports/google-drive/{import_run_id}/raw/{source_profile}/{drive_path}
imports/google-drive/{import_run_id}/manifests/{manifest_file}
exports/{yyyy}/{mm}/{export_job_id}/{filename}
inventory/{aws_inventory_files}
logs/{yyyy}/{mm}/{dd}/{job_or_worker}/{file}
tmp/{job_id}/{filename}
```

Required database concepts:

- `profiles`: local user/profile, Google account, or import profile.
- `import_runs`: import source, source bucket/prefix, account, started/ended,
  checksum policy, and verification status.
- `folders`: Drive-like hierarchy, independent of S3 keys.
- `file_assets`: logical file identity, owner, current folder, labels, and
  visibility.
- `file_versions`: content hash, size, MIME type, S3 bucket/key, checksum,
  scan status, and source provenance.
- `shares` and `permissions`: Drive replacement sharing model.
- `collections` or `workspaces`: curated groups that are not necessarily
  folders.

Migration rule: copy or rehydrate legacy objects into the canonical `objects/`
layout only after checksum/index verification. Keep the raw Google Drive import
under `imports/google-drive/...` until the file has a verified `file_asset` and
`file_version`.

## Canonical Open-Source Buckets To Create

These are the top-level `/home/hasna/workspace/hasna/opensource/open-*` repos.

| Repo | Bucket |
| --- | --- |
| `open-accounts` | `hasna-xyz-opensource-accounts-prod` |
| `open-aicopilot` | `hasna-xyz-opensource-aicopilot-prod` |
| `open-assistants` | `hasna-xyz-opensource-assistants-prod` |
| `open-assistants-legacy` | `hasna-xyz-opensource-assistants-legacy-prod` |
| `open-attachments` | `hasna-xyz-opensource-attachments-prod` |
| `open-brains` | `hasna-xyz-opensource-brains-prod` |
| `open-browser` | `hasna-xyz-opensource-browser-prod` |
| `open-calendar` | `hasna-xyz-opensource-calendar-prod` |
| `open-coders` | `hasna-xyz-opensource-coders-prod` |
| `open-computer` | `hasna-xyz-opensource-computer-prod` |
| `open-configs` | `hasna-xyz-opensource-configs-prod` |
| `open-connectors` | `hasna-xyz-opensource-connectors-prod` |
| `open-contacts` | `hasna-xyz-opensource-contacts-prod` |
| `open-context` | `hasna-xyz-opensource-context-prod` |
| `open-conversations` | `hasna-xyz-opensource-conversations-prod` |
| `open-crawl` | `hasna-xyz-opensource-crawl-prod` |
| `open-deployment` | `hasna-xyz-opensource-deployment-prod` |
| `open-domains` | `hasna-xyz-opensource-domains-prod` |
| `open-economy` | `hasna-xyz-opensource-economy-prod` |
| `open-emails` | `hasna-xyz-opensource-emails-prod` |
| `open-evals` | `hasna-xyz-opensource-evals-prod` |
| `open-files` | `hasna-xyz-opensource-files-prod` |
| `open-hooks` | `hasna-xyz-opensource-hooks-prod` |
| `open-knowledge` | `hasna-xyz-opensource-knowledge-prod` |
| `open-logs` | `hasna-xyz-opensource-logs-prod` |
| `open-machines` | `hasna-xyz-opensource-machines-prod` |
| `open-markdown` | `hasna-xyz-opensource-markdown-prod` |
| `open-mcps` | `hasna-xyz-opensource-mcps-prod` |
| `open-mementos` | `hasna-xyz-opensource-mementos-prod` |
| `open-microservices` | `hasna-xyz-opensource-microservices-prod` |
| `open-monitor` | `hasna-xyz-opensource-monitor-prod` |
| `open-projects` | `hasna-xyz-opensource-projects-prod` |
| `open-prompts` | `hasna-xyz-opensource-prompts-prod` |
| `open-recordings` | `hasna-xyz-opensource-recordings-prod` |
| `open-repos` | `hasna-xyz-opensource-repos-prod` |
| `open-sandboxes` | `hasna-xyz-opensource-sandboxes-prod` |
| `open-search` | `hasna-xyz-opensource-search-prod` |
| `open-secrets` | `hasna-xyz-opensource-secrets-prod` |
| `open-security` | `hasna-xyz-opensource-security-prod` |
| `open-semantics` | `hasna-xyz-opensource-semantics-prod` |
| `open-servers` | `hasna-xyz-opensource-servers-prod` |
| `open-sessions` | `hasna-xyz-opensource-sessions-prod` |
| `open-shortlinks` | `hasna-xyz-opensource-shortlinks-prod` |
| `open-skills` | `hasna-xyz-opensource-skills-prod` |
| `open-styles` | `hasna-xyz-opensource-styles-prod` |
| `open-swarm` | `hasna-xyz-opensource-swarm-prod` |
| `open-takumi` | `hasna-xyz-opensource-takumi-prod` |
| `open-telephony` | `hasna-xyz-opensource-telephony-prod` |
| `open-terminal` | `hasna-xyz-opensource-terminal-prod` |
| `open-testers` | `hasna-xyz-opensource-testers-prod` |
| `open-tickets` | `hasna-xyz-opensource-tickets-prod` |
| `open-todos` | `hasna-xyz-opensource-todos-prod` |
| `open-ui` | `hasna-xyz-opensource-ui-prod` |

## Internal App Buckets

Create these when each app has durable files or needs app-owned exports. Do not
copy the `iapp-` prefix into the bucket name.

```txt
hasna-xyz-internalapp-accounting-prod
hasna-xyz-internalapp-analytics-prod
hasna-xyz-internalapp-banking-prod
hasna-xyz-internalapp-brands-prod
hasna-xyz-internalapp-contracts-prod
hasna-xyz-internalapp-crm-prod
hasna-xyz-internalapp-data-prod
hasna-xyz-internalapp-decompiler-prod
hasna-xyz-internalapp-experts-prod
hasna-xyz-internalapp-grants-prod
hasna-xyz-internalapp-invoices-prod
hasna-xyz-internalapp-legal-prod
hasna-xyz-internalapp-music-prod
hasna-xyz-internalapp-netwatch-prod
hasna-xyz-internalapp-news-prod
hasna-xyz-internalapp-notes-prod
hasna-xyz-internalapp-offer-prod
hasna-xyz-internalapp-payroll-prod
hasna-xyz-internalapp-predictor-prod
hasna-xyz-internalapp-profiling-prod
hasna-xyz-internalapp-reports-prod
hasna-xyz-internalapp-researcher-prod
hasna-xyz-internalapp-scaffolds-prod
hasna-xyz-internalapp-shopping-prod
hasna-xyz-internalapp-signatures-prod
hasna-xyz-internalapp-sourcing-prod
hasna-xyz-internalapp-subscriptions-prod
hasna-xyz-internalapp-takumi-prod
hasna-xyz-internalapp-tax-prod
hasna-xyz-internalapp-timesheets-prod
hasna-xyz-internalapp-trademarks-prod
hasna-xyz-internalapp-transcriber-prod
hasna-xyz-internalapp-utils-prod
hasna-xyz-internalapp-wallets-prod
```

## Company Website Buckets

Use `companywebsite`, not `website`.

```txt
hasna-xyz-companywebsite-hasna-prod
hasna-xyz-companywebsite-hasnafamily-prod
hasna-xyz-companywebsite-hasnafoundation-prod
hasna-xyz-companywebsite-hasnastudio-prod
hasna-xyz-companywebsite-hasnatools-prod
```

`companywebsite/cwebdev/*` folders are dev variants; do not create separate prod
buckets unless promoted.

## Project Buckets

Project buckets are optional and should be created only when the project stores
durable artifacts, exports, backups, or source data. Planning-only projects can
use todos/docs without an S3 bucket.

```txt
hasna-xyz-project-agentavatars-prod
hasna-xyz-project-aicreditsgrants-prod
hasna-xyz-project-aws-naming-migration-prod
hasna-xyz-project-awscosts-prod
hasna-xyz-project-cancelsubscriptions-prod
hasna-xyz-project-designreverseengineering-prod
hasna-xyz-project-gmailtos3-prod
hasna-xyz-project-googledrivetos3-prod
hasna-xyz-project-hasnautcnpartnership-prod
hasna-xyz-project-inboxtozero-prod
hasna-xyz-project-maropostbackup-prod
hasna-xyz-project-payroll-prod
hasna-xyz-project-roaccounting-prod
hasna-xyz-project-rotaxes-prod
hasna-xyz-project-sessionsync-prod
hasna-xyz-project-skill-mining-prod
hasna-xyz-project-uscompaniesdissolution-prod
hasna-xyz-project-ustaxes-prod
hasna-xyz-project-ustrademarks-prod
hasna-xyz-project-usvirtualaddresses-prod
```

## Infra Buckets

Replace legacy infra buckets in phases:

| Purpose | Target bucket |
| --- | --- |
| Terraform state | `hasna-xyz-infra-tfstate-prod` |
| Deploy artifacts | `hasna-xyz-infra-deploy-prod` |
| Shared logs | `hasna-xyz-infra-logs-prod` |
| Shared backups | `hasna-xyz-infra-backups-prod` |
| S3 inventory reports | `hasna-xyz-infra-inventory-prod` |

Do not delete old infra buckets until Terraform state, deployed artifact
references, and inventory consumers have been moved and verified.

## Secrets Structure

Use the same path in AWS Secrets Manager and the local `secrets` CLI.

App-owned runtime secret pattern:

```txt
hasna/{division}/{app_type}/{app}/{env}/{component}
```

Shared infra/admin secret pattern:

```txt
hasna/{division}/infra/{resource_group}/{env}/{component}/{role}
```

Examples:

```txt
hasna/xyz/opensource/files/prod/env
hasna/xyz/opensource/files/prod/aws
hasna/xyz/opensource/files/prod/rds
hasna/xyz/opensource/todos/prod/env
hasna/xyz/internalapp/accounting/prod/env
hasna/xyz/companywebsite/hasna/prod/env
hasna/xyz/project/googledrivetos3/prod/env
hasna/xyz/infra/apps/prod/postgres/master
hasna/xyz/infra/tfstate/prod/aws
```

Current AWS Secrets Manager legacy names in `hasna-xyz-infra`:

```txt
prod/microservice/rds/master
prod/connect/rds/master
internalapps/prod/rds/master
internalapps/prod/iapp-news/env
```

Canonical non-secret config paths created on 2026-06-07:

```txt
hasna/xyz/opensource/files/prod/env
hasna/xyz/infra/tfstate/prod/aws
```

These exist in AWS Secrets Manager in `hasna-xyz-infra` and in the local
`spark02` `secrets` vault. They contain bucket names, regions, import source
URIs, and Terraform state settings; they do not contain passwords or tokens.

Canonical RDS pointer created on 2026-06-08:

```txt
hasna/xyz/infra/apps/prod/postgres/master
hasna/xyz/opensource/files/prod/rds
```

The infra master pointer exists in AWS Secrets Manager in `hasna-xyz-infra` and
in the local `spark02` `secrets` vault. It contains connection metadata and an
RDS-managed master secret ARN pointer, not the password itself.

The `open-files` app runtime RDS secret exists in AWS Secrets Manager and local
`secrets`; it contains the app runtime connection fields for database `files`
and role `files_app`.

Local `secrets` on `spark02` still also has legacy live-env vault keys.
`spark01` and `apple03` did not expose a `secrets` CLI in PATH during the
audit, so they need the CLI installed or PATH fixed before local vault entries
can be synced there.

Migration rule: create new canonical secrets, update app config to read the new
path, verify, then keep old secrets for a deprecation window before deletion.
Do not print secret values during audits.

## RDS Plan

Avoid `microservice` as the shared database name. It describes an old grouping,
not the resource owner.

Target:

```txt
Identifier: hasna-xyz-infra-apps-prod-postgres
Master secret: hasna/xyz/infra/apps/prod/postgres/master
Database naming: one database/schema per app where shared cluster use is acceptable
```

RDS secret ownership rule:

- Shared infra/admin credentials use shared infra paths, such as
  `hasna/xyz/infra/apps/prod/postgres/master`.
- App runtime database credentials stay under the app owner path, such as
  `hasna/xyz/opensource/files/prod/rds` or
  `hasna/xyz/internalapp/accounting/prod/rds`.
- Do not put every app database secret under `infra/apps`, because that loses
  app ownership, IAM/audit clarity, and rotation boundaries.
- Do not put shared master credentials under `internalapp` or `opensource`,
  because the shared database serves multiple app types.

Current RDS instances:

| Account/profile | Region | Instance | Status |
| --- | --- | --- | --- |
| `hasna-xyz-infra` | `us-east-1` | `internalapps-prod-postgres` | Private, encrypted, deletion protection enabled, Postgres 15.8, 50 GB, `db.t4g.small`. Good baseline but legacy name. |
| `hasna-xyz-infra` | `us-east-1` | `prod-connect` | Public, unencrypted, Postgres 16.4, 20 GB, `db.t4g.micro`. Migrate away. |
| `hasna-xyz-infra` | `us-east-1` | `prod-microservice` | Public, unencrypted, Postgres 16.4, 20 GB, `db.t4g.micro`. Migrate away. |
| `hasna-xyz-hq` | `us-east-1` | `hasnaxyz-prod-opensource` | Public, unencrypted, Postgres 16.4, 20 GB, `db.t4g.micro`. Migrate into infra account. |
| `hasna-xyz-hq` | `eu-central-1` | `prod-companywebsite` | Private, encrypted, deletion protection enabled, Postgres 16.13, 20 GB, `db.t4g.micro`. Evaluate separately before moving regions/accounts. |

`hasna-xyz-infra` currently uses the default VPC
`vpc-04c7f7abc1d3c3f56`. The private encrypted baseline DB uses subnet group
`internalapps-prod-db-subnets`; the two legacy public DBs use
`prod-microservice-subnets`.

Execution update on 2026-06-08:

- Created Terraform module:
  `/home/hasna/workspace/hasnaxyz/project/project-aws-naming-migration/terraform/hasna-xyz-rds`.
- Created target RDS instance `hasna-xyz-infra-apps-prod-postgres` in
  `hasna-xyz-infra` / `us-east-1`.
- Endpoint:
  `hasna-xyz-infra-apps-prod-postgres.culaqeaao9n7.us-east-1.rds.amazonaws.com:5432`.
- The target is private, encrypted, deletion-protected, Postgres 16.4,
  `db.t4g.small`, gp3, 50 GB with autoscaling to 200 GB, IAM DB auth enabled,
  14-day backups, CloudWatch Postgres/upgrade logs, and Performance Insights.
- Security group `sg-0da76295c87f975c5` allows Postgres ingress only from
  existing host security group `sg-0df302ed4598ca171`.
- Master password is held in the RDS-managed master user secret. The canonical
  secret `hasna/xyz/infra/apps/prod/postgres/master` is only a pointer/metadata
  document and was mirrored into local `secrets`.
- Post-apply Terraform plan returned no changes.
- Provisioned `open-files` app database `files` and runtime role `files_app`.
  The app-owned runtime secret is `hasna/xyz/opensource/files/prod/rds`.
- Applied the repo's PostgreSQL schema from `src/db/pg-migrations.ts` to the
  `files` database. Verification as `files_app` showed 19 public tables:
  `machines`, `sources`, `files`, `tags`, `file_tags`, `collections`,
  `collection_files`, `projects`, `project_files`, `peers`, `feedback`,
  `agents`, `agent_activity`, `google_drive_sync_state`,
  `google_drive_imported_objects`, `file_assets`, `file_upload_intents`,
  `file_links`, and `file_access_events`.
- Installed the AWS Session Manager plugin locally on `spark02` and used an SSM
  port-forward through `internalapps-prod-host`
  (`i-086c334559bec7e0f`) because the RDS instance is private and only accepts
  Postgres traffic from host security group `sg-0df302ed4598ca171`.
- Imported the live `open-files` SQLite/Drive metadata into canonical Postgres
  and applied the canonical Drive object mapping. Verification showed
  `sources=6`, `machines=1`, `files=18,212`,
  `google_drive_imported_objects=18,212`, `drive_mapped=18,212`,
  `drive_missing_mapping=0`, and `distinct_canonical_keys=15,648`.
- Live smoke on 2026-06-08 used a temporary SQLite DB populated from canonical
  Postgres through the SSM tunnel, then closed the tunnel. Evidence directory:
  `/tmp/open-files-canonical-smoke-x85Wr4`.
  - `files storage pull` read and wrote `18,212` `files` rows, `6` `sources`
    rows, and `18,212` `google_drive_imported_objects` rows with `0` errors.
  - `files storage status` reported `mode=hybrid`,
    `remote_configured=true`, bucket `hasna-xyz-opensource-files-prod`, prefix
    `objects/sha256`, local files `18,212`, and local Drive rows `18,212`.
  - CLI `list` returned 3 rows and CLI `search` returned 4 rows from the
    Postgres-pulled temp DB. The pull path now refreshes SQLite FTS after
    remote `files`/tag rows are pulled.
  - CLI `resolve` and `download` resolved small file `f_0_7yEJlFSG` through
    canonical key
    `objects/sha256/18/fa/18fa26fa74685c3bd2547879e4db1c41d7b6ecfe7fe7799ec8fc8d24af0e457b`;
    download size was `70` bytes and SHA-256 matched the mapping.
  - CLI `resolve` resolved the >5GiB file `f_9BdHQJGCPN` without downloading it:
    size `19,344,300,537`, key
    `objects/sha256/4e/10/4e108c977a1cd76f2c26881f11e30d22d017ea7b512936c0a216743c14f7d91a`.
  - Evidence upload-intent smoke created a pending intent and pending asset in
    the temp DB for bucket `hasna-xyz-opensource-files-prod` under
    `smoke-upload-intents/`; it generated a pre-signed URL and did not upload
    bytes.
  - SDK smoke resolved the small file as `google_drive_canonical_s3` in bucket
    `hasna-xyz-opensource-files-prod`.
  - MCP smoke registered 82 tools, reported storage status `hybrid`, listed 1
    file, and resolved the small file as `google_drive_canonical_s3`.
- The first smoke attempt found a real mismatch: `files.source_id` rows still
  point at a legacy S3 source, so download attempted the legacy raw
  `google-drive/...` key. The resolver now prefers
  `google_drive_imported_objects.file_record_id` canonical mappings for any
  file row before falling back to the file's source. CLI, SDK, and MCP object
  resolution/download paths use this shared resolver.
- Legacy rollback and read-only policy:
  `docs/open-files-legacy-rollback-policy.md`.
- Drive archive organization workflow:
  `docs/open-files-drive-organization-workflow.md`. The queue bootstrap created
  18,212 review rows, split into 5,969 My Drive rows and 12,243 Shared Drive
  rows, with 4,382 duplicate-review rows. The review tables and queue
  collection memberships were pushed to canonical Postgres.

Remaining RDS work:

- Create per-app databases/users and app-owned runtime secrets for the other
  apps that need Postgres.
- Migrate legacy data from `prod-microservice`, `prod-connect`,
  `hasnaxyz-prod-opensource`, and app-specific legacy databases.
- Run row-count/checksum/app smoke verification.
- Freeze old DBs read-only for the rollback window, then retire them.

Steps:

1. Create or rename toward `hasna-xyz-infra-apps-prod-postgres`. Done on
   2026-06-08 by creating the new target.
2. Store master secret at `hasna/xyz/infra/apps/prod/postgres/master`. Done on
   2026-06-08 as a pointer to the RDS-managed master secret.
3. Create app DB/users/secrets per app:
   `hasna/xyz/{app_type}/{app}/prod/rds`. Done for `open-files`; still pending
   for other apps that need Postgres.
4. Import `open-files` SQLite/Drive metadata into the `files` database. Done on
   2026-06-08, including canonical row-to-object mapping and CLI/SDK/MCP smoke.
5. Migrate data from `prod-microservice`, `prod-connect`,
   `hasnaxyz-prod-opensource`, and app-specific legacy DBs.
6. Make apps read canonical secrets.
7. Verify migrations with row counts, checksums where possible, and app smoke
   tests.
8. Freeze old DBs, keep read-only during rollback window, then retire.

## Execution Order

1. Freeze naming: this document is the canonical name map.
2. Create Terraform modules or configuration for the target S3 buckets, tags,
   lifecycle, encryption, inventory, and public access blocks.
3. Create canonical open-source buckets first, especially
   `hasna-xyz-opensource-files-prod`.
4. Add canonical AWS/local secrets for S3 bucket names, regions, and app env.
5. Update `open-files` to import the Drive archive from
   `hasna-xyz-prod-files/google-drive/` into
   `hasna-xyz-opensource-files-prod`.
6. Build the file organization workflow:
   inventory, classify, assign owner/folder/project, move metadata, verify.
7. Update each `open-*` app to use its canonical bucket and secret path. This
   work is intentionally task-only here because another agent is updating apps.
8. Create the canonical infra RDS resource and secrets.
9. Migrate legacy RDS data into the canonical RDS layout.
10. Migrate internal app and company website buckets as apps become ready.
11. Mark old buckets and secrets as legacy/read-only.
12. Retire old resources only after inventory, app smoke tests, and rollback
    windows pass.

## Open-Files Runtime Cutover - 2026-06-08

`open-files` runtime defaults now point at the canonical bucket
`hasna-xyz-opensource-files-prod`.

- Evidence upload/config defaults use `hasna-xyz-opensource-files-prod` in
  `us-east-1`; `hasna-files-prod` is legacy only and its discovered smoke
  evidence has been copied to the canonical legacy-bucket import prefix.
- `files sources bootstrap-prod-files` defaults to
  `s3://hasna-xyz-opensource-files-prod/imports/google-drive/live` with AWS
  profile `hasna-xyz-infra`.
- The `bootstrap-prod-emails` command remains as a compatibility alias, but it
  uses the same canonical defaults.
- Old S3 source names and buckets such as `prod-emails-drive`,
  `hasna-xyz-prod-emails`, `hasna-xyz-prod-files`, and `hasna-prod-files` are
  still recognized by bootstrap repair logic so existing source rows can be
  updated safely instead of orphaned.
- The verified Drive archive remains content-addressed under
  `s3://hasna-xyz-opensource-files-prod/objects/sha256/`; new live Drive
  imports should not be written into that prefix directly.

## Open-Files Adversarial Audit - 2026-06-08

The open-files storage/runtime adversarial audit passed. See
[open-files-adversarial-migration-audit.md](open-files-adversarial-migration-audit.md).

Current verified state:

- S3 source of record and canonical raw copy both have 18,212 objects /
  132,917,143,313 bytes.
- Canonical object prefix has 15,648 content-addressed objects /
  128,358,442,514 bytes.
- Canonical Postgres has 18,212 files, 18,212 Drive import rows, 18,212 mapped
  canonical rows, 0 missing canonical keys, 0 Drive rows without file joins, and
  0 files without Drive mappings.
- The active source row is `src_p8WUDEpmRP` -> `prod-files-drive`,
  `hasna-xyz-opensource-files-prod`, `imports/google-drive/live`, `us-east-1`.
- CLI, SDK, and MCP resolver checks return `google_drive_canonical_s3` under
  `objects/sha256`.

Legacy retirement is still blocked by row-by-row owner/ACL review, the
rollback window, owner approval, and the broader cross-account adversarial
verification. Post-guardrail inventory/equivalent manifest evidence is now
attached under task `3fae082e`.

## Open-Files Legacy Guardrails - 2026-06-08

AWS deny-write guardrails now protect the two legacy Drive prefixes used by the
open-files migration:

| Bucket | Prefix | Deny SID | Inventory |
| --- | --- | --- | --- |
| `hasna-xyz-prod-files` | `google-drive/` | `DenyOpenFilesLegacyGoogleDriveWritesExceptBreakGlass` | Daily ORC inventory `open-files-legacy-google-drive-daily` to `s3://hasna-xyz-infra-inventory-prod/s3/hasna-xyz-prod-files/google-drive/`; report `2026-06-08T01-00Z` delivered. |
| `hasna-xyz-prod-emails` | `drive/` | `DenyOpenFilesLegacyEmailDriveWritesExceptBreakGlass` | Daily ORC inventory `open-files-legacy-drive-daily` to `s3://hasna-xyz-prod-emails/inventory/open-files-legacy-drive/`; no filtered report object yet as of the 2026-06-09 evidence pass, so an equivalent metadata manifest is attached. |

Break-glass write exception:

```txt
arn:aws:iam::789877399345:role/hasna-xyz-open-files-legacy-drive-breakglass-prod
```

Verification after policy update:

- Representative `head-object` checks succeeded for one object under each
  legacy prefix, proving rollback read access remains.
- IAM simulation returned `explicitDeny` for `s3:PutObject` and
  `s3:DeleteObject` on both protected prefixes for the normal infra role.
- Local source state has only the canonical S3 source enabled:
  `src_p8WUDEpmRP`, `hasna-xyz-opensource-files-prod`,
  `imports/google-drive/live`.
- Canonical inventory already produced a daily ORC report for
  `hasna-xyz-opensource-files-prod` at `2026-06-08T01-00Z`.
- Legacy source-of-record inventory produced an ORC report for
  `hasna-xyz-prod-files/google-drive/` at `2026-06-08T01-00Z`.
- The regional bucket-level inventory for `hasna-xyz-prod-emails` produced an
  ORC report at `2026-06-08T01-00Z`; the specific filtered
  `inventory/open-files-legacy-drive/` destination prefix is still empty, so
  evidence asset `asset_d636d93ea2944da6` includes an equivalent metadata
  manifest for `hasna-xyz-prod-emails/drive/`.

Task `3fae082e` was completed after attaching evidence:

```txt
asset: asset_d636d93ea2944da6
s3: s3://hasna-xyz-opensource-files-prod/orgs/hasna-xyz/companies/_global/open-files/2026/06/s3-inventory-evidence/asset_d636d93ea2944da6/open-files-s3-inventory-evidence-20260609T025315Z.tar.gz
sha256: 7abb42272087837e7c21fcc9e262c7bf5342a2ac901352b43b303ddb3602c0f3
size: 3,720,796 bytes
status: verified
```

The attached bundle verifies:

```txt
legacy google-drive: 18,212 objects / 132,917,143,313 bytes
canonical raw import: 18,212 objects / 132,917,143,313 bytes
canonical sha256 objects: 15,648 objects / 128,358,442,514 bytes
legacy email drive: 128 objects / 348,381,076 bytes
```

## Adversarial Checks

- Confirm no new code points at `hasna-xyz-prod-emails/drive/` for Drive files.
- Confirm `hasna-xyz-prod-files/google-drive/` remains readable until the new
  `open-files` archive is complete.
- Confirm object counts and bytes before and after each bucket migration.
- Confirm every bucket has public access blocked, versioning enabled, and owner
  enforced.
- Confirm old AWS secret paths have a new canonical equivalent before any app
  is cut over.
- Confirm apps do not hard-code bucket names when a canonical secret exists.
- Confirm local `spark01`, `spark02`, and `apple03` secret key structures use
  the same canonical path shape.
- Confirm `opensourcedev` folders do not create duplicate prod buckets.
  Confirmed by central task `df901927` on 2026-06-10: current scope remains 56
  top-level live `open-*` repos. The 46 `opensource/opensourcedev/open-*`
  folders are development/native-storage variants and are not separate
  production S3 bucket owners unless promoted later.
- Confirm stale todos project path rows do not create duplicate prod buckets.
  Confirmed by central task `a1fb34a0` on 2026-06-10: corrected unambiguous
  machine-local path overrides and recorded the empty `open-maropost-backup`
  row as stale/non-owner.
- Confirm stale non-open-source project path rows do not create duplicate prod
  buckets. Confirmed by central task `efa0f406` on 2026-06-10: corrected
  unambiguous `companywebsite`/`project` machine-local path overrides and
  recorded missing alias/planning rows as non-owners unless promoted.
- Confirm removed `projectmaintain` path rows do not hide missing project bucket
  tasks. Confirmed by central task `c676ad24` on 2026-06-10: added explicit
  pending `project-rotaxes` and `project-ustrademarks` migration chains and
  recorded zero-task `projectmaintain` aliases as non-owners unless promoted.
- Confirm every live project bucket matrix row has a pending migration chain or
  a completed no-storage disposition. Confirmed by central task `45a1f34c` on
  2026-06-10 using aggregate-only live project scan artifacts.
