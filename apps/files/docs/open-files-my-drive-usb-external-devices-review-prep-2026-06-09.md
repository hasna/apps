# Open Files My Drive USB and External Devices Review Prep - 2026-06-09

Scope: read-only preparation for task `47db3f15`, the My Drive top-level folder
`USB and External Devices`.

This document does not assign owners, set target paths, approve ACLs, mark
duplicates, mark files moved, rewrite S3 keys, or change canonical Postgres.

Source packet:

```txt
local: /home/hasna/.hasna/files/open-files-unassigned-review-packets-20260609T052604+0300/usb-and-external-devices.json
s3 asset: asset_e3906bfbb4c447fb
s3 archive: s3://hasna-xyz-opensource-files-prod/orgs/hasna-xyz/companies/_global/open-files/2026/06/drive-unassigned-review-packets/asset_e3906bfbb4c447fb/open-files-unassigned-review-packets-20260609T052604-0300.tar.gz
archive sha256: e7977ac67e9a6b8a26347aa4d16cb0993c6572a28ac60c6195926ba9dbf80f6a
```

## Packet Shape

| Measure | Count |
| --- | ---: |
| Groups | 1 |
| Rows | 1,300 |
| Duplicate-overlap rows | 3 |
| Root files | 0 |
| Review track | external-device-archive-owner-review |

Review reasons:

| Reason | Present |
| --- | ---: |
| `missing_owner_or_target` | yes |
| `contains_duplicate_rows` | yes |
| `external_device_archive` | yes |

## File Shape

| Measure | Count |
| --- | ---: |
| Image rows | 1,157 |
| Video rows | 143 |
| Zero-size rows | 3 |
| Total bytes | 6,294,922,132 |
| Min row bytes | 0 |
| Median row bytes | 1,636,258 |
| P90 row bytes | 4,825,755 |
| Max row bytes | 303,136,474 |

Detailed MIME breakdown:

| MIME type | Rows |
| --- | ---: |
| `image/heif` | 515 |
| `image/png` | 371 |
| `image/jpeg` | 269 |
| `video/quicktime` | 105 |
| `video/mp4` | 38 |
| `image/webp` | 2 |

## Review Lane

All 1,300 rows should remain `owner-review-required` until an owner confirms
placement. The folder name and MIME mix suggest an external-device media archive,
but they do not establish whether the correct target is a business archive, a
personal or mixed archive, a media/archive split by owner, or an approved
exception.

The three duplicate-overlap rows need duplicate-gate coordination before any
survivor or exception decision. The three zero-size rows need owner/source
validation before the final Drive organization audit because they may represent
empty files, export artifacts, placeholders, or incomplete source copies.

Reviewer guidance:

1. Confirm whether this external-device archive belongs to Hasna business
   records, a specific person/team, a mixed archive, or an approved exception.
2. Keep the 1,300 rows in owner review until the owner assignment decision is
   approved on task `47db3f15`.
3. Review the three duplicate-overlap rows with duplicate gate `c1b639c8`
   before marking canonical survivors, true duplicates, or duplicate exceptions.
4. Validate the three zero-size rows against the original source/export evidence
   before allowing final audit task `617a5bb0` to pass.
5. Do not infer ACL risk from the folder label or media type. ACL review remains
   separate and should flow through the post-unassigned My Drive ACL gate
   `424ecee9` after owner assignment.
6. Use owner approval gate `drive-owner-assignment-approval` on task `47db3f15`
   before applying owner or target-path metadata.

Recommended command pattern:

```bash
bun src/cli/index.tsx organize unassigned --root-type my_drive --top-level "USB and External Devices" --include-rows --json
```

Do not run `organize review` for this queue until the owner approval gate is
recorded.
