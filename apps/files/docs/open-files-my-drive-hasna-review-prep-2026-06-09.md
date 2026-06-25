# Open Files My Drive Hasna Review Prep - 2026-06-09

Scope: read-only preparation for task `6383c787`, the My Drive top-level folder
`Hasna`.

This document does not assign owners, set target paths, approve ACLs, mark
duplicates, mark files moved, rewrite S3 keys, or change canonical Postgres.

Source packet:

```txt
local: /home/hasna/.hasna/files/open-files-unassigned-review-packets-20260609T052604+0300/hasna.json
s3 asset: asset_e3906bfbb4c447fb
s3 archive: s3://hasna-xyz-opensource-files-prod/orgs/hasna-xyz/companies/_global/open-files/2026/06/drive-unassigned-review-packets/asset_e3906bfbb4c447fb/open-files-unassigned-review-packets-20260609T052604-0300.tar.gz
archive sha256: e7977ac67e9a6b8a26347aa4d16cb0993c6572a28ac60c6195926ba9dbf80f6a
```

## Packet Shape

| Measure | Count |
| --- | ---: |
| Groups | 1 |
| Rows | 15 |
| Duplicate-overlap rows | 0 |
| Root files | 0 |
| Review track | folder-owner-review |

## File Shape

| Measure | Count |
| --- | ---: |
| PDF rows | 14 |
| PNG rows | 1 |
| Zero-size rows | 0 |
| Total bytes | 67,360,503 |
| Min row bytes | 329,434 |
| Median row bytes | 4,954,365 |
| Max row bytes | 5,432,467 |

## Review Lane

All 15 rows should remain `owner-review-required` until an owner confirms
placement. The folder name suggests the files may be Hasna-owned, but it does
not determine whether the correct placement is business records, personal
archive, legal/finance records, or split placement.

Reviewer guidance:

1. Confirm whether the folder belongs under a specific Hasna business area,
   personal archive, or approved exception.
2. If rows span multiple owners, split only after the owner approval gate is
   recorded.
3. Do not infer ACL risk from the folder name. ACL review remains separate and
   should flow through the post-unassigned My Drive ACL gate `424ecee9` after
   owner assignment.
4. Use owner approval gate `drive-owner-assignment-approval` on task
   `6383c787` before applying owner or target-path metadata.

Recommended command pattern:

```bash
bun src/cli/index.tsx organize unassigned --root-type my_drive --top-level "Hasna" --include-rows --json
```

Do not run `organize review` for this queue until the owner approval gate is
recorded.
