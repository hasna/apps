# Open Files My Drive Archive Review Prep - 2026-06-09

Scope: read-only preparation for task `745d55d9`, the My Drive top-level folder
`Archive`.

This document does not assign owners, set target paths, approve ACLs, mark
duplicates, mark files moved, rewrite S3 keys, or change canonical Postgres.

Source packet:

```txt
local: /home/hasna/.hasna/files/open-files-unassigned-review-packets-20260609T052604+0300/archive.json
s3 asset: asset_e3906bfbb4c447fb
s3 archive: s3://hasna-xyz-opensource-files-prod/orgs/hasna-xyz/companies/_global/open-files/2026/06/drive-unassigned-review-packets/asset_e3906bfbb4c447fb/open-files-unassigned-review-packets-20260609T052604-0300.tar.gz
archive sha256: e7977ac67e9a6b8a26347aa4d16cb0993c6572a28ac60c6195926ba9dbf80f6a
```

## Packet Shape

| Measure | Count |
| --- | ---: |
| Groups | 1 |
| Rows | 20 |
| Duplicate-overlap rows | 1 |
| Root files | 0 |
| Review track | archive-owner-review |

## File Shape

| Measure | Count |
| --- | ---: |
| PDF rows | 16 |
| DOCX rows | 2 |
| XLSX rows | 1 |
| Text rows | 1 |
| Zero-size rows | 0 |
| Total bytes | 1,014,706 |
| Min row bytes | 4,469 |
| Median row bytes | 32,282 |
| Max row bytes | 167,803 |

## Review Lane

All 20 rows should remain `owner-review-required` until an owner confirms
placement. The `Archive` folder name is not specific enough to infer a business
owner, target collection, or approved exception.

Reviewer guidance:

1. Confirm whether this is a business archive, a personal/mixed archive, or a
   set of files that should be split across owners.
2. Coordinate the one duplicate-overlap row with duplicate gate `c1b639c8`
   before marking canonical survivors or duplicate exceptions.
3. Do not infer ACL risk from the folder name. ACL review remains separate and
   should flow through the post-unassigned My Drive ACL gate `424ecee9` after
   owner assignment.
4. Use owner approval gate `drive-owner-assignment-approval` on task
   `745d55d9` before applying owner or target-path metadata.

Recommended command pattern:

```bash
bun src/cli/index.tsx organize unassigned --root-type my_drive --top-level "Archive" --include-rows --json
```

Do not run `organize review` for this queue until the owner approval gate is
recorded.
