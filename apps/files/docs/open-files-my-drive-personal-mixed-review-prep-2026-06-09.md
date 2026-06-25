# Open Files My Drive Personal/Mixed Review Prep - 2026-06-09

Scope: read-only preparation for task `c4cbfd85`, the My Drive top-level folder
`Pentru Diana & Andrei`.

This document does not assign owners, set target paths, approve ACLs, mark
duplicates, mark files moved, rewrite S3 keys, or change canonical Postgres.

Source packet:

```txt
local: /home/hasna/.hasna/files/open-files-unassigned-review-packets-20260609T052604+0300/pentru-diana-andrei.json
s3 asset: asset_e3906bfbb4c447fb
s3 archive: s3://hasna-xyz-opensource-files-prod/orgs/hasna-xyz/companies/_global/open-files/2026/06/drive-unassigned-review-packets/asset_e3906bfbb4c447fb/open-files-unassigned-review-packets-20260609T052604-0300.tar.gz
archive sha256: e7977ac67e9a6b8a26347aa4d16cb0993c6572a28ac60c6195926ba9dbf80f6a
```

## Packet Shape

| Measure | Count |
| --- | ---: |
| Groups | 1 |
| Rows | 16 |
| Duplicate-overlap rows | 0 |
| Root files | 0 |
| Review track | folder-owner-review |

## File Shape

| Measure | Count |
| --- | ---: |
| PDF rows | 8 |
| XLSX rows | 5 |
| JPEG rows | 2 |
| PNG rows | 1 |
| Zero-size rows | 0 |
| Total bytes | 18,344,300 |
| Min row bytes | 24,725 |
| Median row bytes | 169,449 |
| Max row bytes | 12,880,801 |

## Review Lane

All 16 rows should remain `owner-review-required` and `personal/mixed` until an
owner confirms placement or an approved exception. The packet is intentionally
not auto-assigned because the top-level folder name is personal/mixed and the
file-type mix spans documents, spreadsheets, and images.

Reviewer guidance:

1. Confirm whether the packet belongs in Hasna business records, a personal
   archive, a mixed exception, or multiple owner-approved placements.
2. Do not infer ACL risk from the folder name. ACL review remains separate and
   should flow through the post-unassigned My Drive ACL gate `424ecee9` after
   owner assignment.
3. Use owner approval gate `drive-owner-assignment-approval` on task
   `c4cbfd85` before applying owner or target-path metadata.

Recommended command pattern:

```bash
bun src/cli/index.tsx organize unassigned --root-type my_drive --top-level "Pentru Diana & Andrei" --include-rows --json
```

Do not run `organize review` for this queue until the owner approval gate is
recorded.
