# Open Files My Drive Hasna (3) Review Prep - 2026-06-09

Scope: read-only preparation for task `fd25524e`, the My Drive top-level folder
`Hasna (3)`.

This document does not assign owners, set target paths, approve ACLs, mark
duplicates, mark files moved, rewrite S3 keys, or change canonical Postgres.

Source packet:

```txt
local: /home/hasna/.hasna/files/open-files-unassigned-review-packets-20260609T052604+0300/hasna-3.json
s3 asset: asset_e3906bfbb4c447fb
s3 archive: s3://hasna-xyz-opensource-files-prod/orgs/hasna-xyz/companies/_global/open-files/2026/06/drive-unassigned-review-packets/asset_e3906bfbb4c447fb/open-files-unassigned-review-packets-20260609T052604-0300.tar.gz
archive sha256: e7977ac67e9a6b8a26347aa4d16cb0993c6572a28ac60c6195926ba9dbf80f6a
```

## Packet Shape

| Measure | Count |
| --- | ---: |
| Groups | 1 |
| Rows | 180 |
| Duplicate-overlap rows | 166 |
| Root files | 0 |
| Review track | legacy-hasna-folder-owner-review |

## File Shape

| Measure | Count |
| --- | ---: |
| Image rows | 81 |
| Font rows | 40 |
| Vector/artwork rows | 43 |
| Figma rows | 5 |
| PDF/text rows | 6 |
| ZIP rows | 3 |
| Video rows | 1 |
| Other binary rows | 1 |
| Zero-size rows | 0 |
| Total bytes | 2,774,173,507 |
| Min row bytes | 745 |
| Median row bytes | 82,656 |
| Max row bytes | 956,484,161 |

Detailed MIME breakdown:

| MIME type | Rows |
| --- | ---: |
| `image/jpeg` | 53 |
| `application/x-font-ttf` | 29 |
| `image/png` | 28 |
| `application/postscript` | 27 |
| `image/svg+xml` | 13 |
| `application/x-font-otf` | 10 |
| `application/x-figma` | 5 |
| `application/pdf` | 4 |
| `application/x-xfig` | 3 |
| `application/zip` | 3 |
| `text/plain` | 2 |
| `application/font-woff` | 1 |
| `application/octet-stream` | 1 |
| `video/mp4` | 1 |

## Review Lane

All 180 rows should remain `owner-review-required` until an owner confirms
placement. The file-type mix strongly suggests design/brand/archive material,
but the folder label alone does not determine whether the correct placement is
marketing-sales, product, workspace, a Hasna business archive, or an approved
exception.

The 166 duplicate-overlap rows are the main risk. Do not mark canonical
survivors, true duplicates, or duplicate exceptions from this packet alone.
Coordinate those rows with duplicate gate `c1b639c8` and the owner-scoped
duplicate packets before applying any decision.

Reviewer guidance:

1. Confirm whether this is a business design/archive collection, a personal or
   mixed archive, or a set of files that should be split across owners.
2. Review duplicate-overlap rows with duplicate gate `c1b639c8` before marking
   canonical survivors or duplicate exceptions.
3. Do not infer ACL risk from the folder name. ACL review remains separate and
   should flow through the post-unassigned My Drive ACL gate `424ecee9` after
   owner assignment.
4. Use owner approval gate `drive-owner-assignment-approval` on task
   `fd25524e` before applying owner or target-path metadata.

Recommended command pattern:

```bash
bun src/cli/index.tsx organize unassigned --root-type my_drive --top-level "Hasna (3)" --include-rows --json
```

Do not run `organize review` for this queue until the owner approval gate is
recorded.
