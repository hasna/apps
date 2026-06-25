# Open Files Shared-Drive Product ACL Review Prep - 2026-06-09

Scope: read-only preparation for task `e4cb7380`, the shared-drive Product ACL
approval packet.

This document does not approve ACLs, change `acl_review_status`,
`permission_scope`, or `permission_risk`, mark duplicates, mark files moved,
rewrite S3 keys, or change canonical Postgres.

Source packet:

```txt
local: /home/hasna/.hasna/files/open-files-acl-approval-packets-20260609T051621+0300/shared_drive-product-acl-approval-packet.json
packet sha256: b76888f51ee8ca34936f69bb38d3f9cc4cb40c7d8a8140d3986fae43670415dd
s3 asset: asset_544ff24ee4b74b07
s3 archive: s3://hasna-xyz-opensource-files-prod/orgs/hasna-xyz/companies/_global/open-files/2026/06/drive-acl-approval-packets/asset_544ff24ee4b74b07/open-files-acl-approval-packets-20260609T051621-0300.tar.gz
archive sha256: f2a714c64d9c0098de816d3b58ae303377776b02e670a85134f4c26ac6a72449
generated at: 2026-06-09T02:16:21.692Z
```

## Packet Shape

| Measure | Count |
| --- | ---: |
| Rows | 6,242 |
| Total bytes | 79,505,169,997 |
| Duplicate-overlap rows | 2,276 |
| Unassigned rows | 0 |
| Missing-target rows | 0 |
| Sample rows in packet | 100 |
| Duplicate group summaries in packet | 50 |
| Rows represented by included duplicate summaries | 276 |

All rows in the packet currently have:

| Field | Value | Count |
| --- | --- | ---: |
| `review_status` | `in_review` | 6,242 |
| `acl_review_status` | `needs_review` | 6,242 |
| `permission_scope` | `shared_drive` | 6,242 |
| `permission_risk` | `unknown` | 6,242 |
| top-level folder | `Product` | 6,242 |

## 2026-06-11 Read-Only Re-Audit

Task `9e0a98c4` recomputed the shared-drive Product ACL lane from the local
review database without printing file names, paths, object keys, ACL payloads,
or changing review rows. The packet shape still matches this document: 6,242
rows, 79,505,169,997 bytes, 2,276 duplicate-overlap rows, zero unassigned rows,
and zero missing-target rows. All 6,242 rows still have `acl_review_status =
needs_review`, `permission_scope = shared_drive`, and `permission_risk =
unknown`. No rows in this lane are marked moved or duplicate.

The full current lane contains 925 distinct duplicate groups behind the 2,276
duplicate-overlap rows; the original reviewer packet included summaries for 50
of those groups. Duplicate survivor decisions remain outside this ACL lane.

The same audit verified the task-local `drive-acl-owner-approval` checkpoint is
still pending and has not been completed.

Evidence:

| Artifact | Lines | SHA-256 |
| --- | ---: | --- |
| `/tmp/open-files-shared-drive-product-acl-aggregate-audit-2026-06-11.tsv` | 22 | `1fb8a3546d3791115e892715cad85f761dfd750c3a6fd4253647275a19cda1be` |

The 100 sample rows are not exhaustive. The included duplicate group summaries
are also not exhaustive; they cover the top 50 groups from the packet command.

## File Shape

Largest MIME groups by row count:

| MIME type | Rows | Bytes |
| --- | ---: | ---: |
| `image/jpeg` | 1,356 | 2,554,314,356 |
| `image/svg+xml` | 1,135 | 528,699,836 |
| `image/png` | 911 | 1,127,417,894 |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | 522 | 187,626,980 |
| `video/mp4` | 503 | 18,351,233,992 |
| `application/pdf` | 496 | 904,284,430 |
| `image/x-sony-arw` | 443 | 21,764,559,360 |
| `video/quicktime` | 273 | 13,357,368,453 |
| `application/postscript` | 241 | 610,328,147 |
| `image/x-photoshop` | 69 | 4,438,760,226 |
| `audio/mpeg` | 49 | 1,518,205,139 |
| `application/octet-stream` | 43 | 189,982,958 |

Largest MIME groups by bytes:

| MIME type | Rows | Bytes |
| --- | ---: | ---: |
| `image/x-sony-arw` | 443 | 21,764,559,360 |
| `video/mp4` | 503 | 18,351,233,992 |
| `video/quicktime` | 273 | 13,357,368,453 |
| `application/zip` | 23 | 11,207,473,132 |
| `image/x-photoshop` | 69 | 4,438,760,226 |
| `image/jpeg` | 1,356 | 2,554,314,356 |

## Duplicate Context

The packet reports 2,276 duplicate-overlap rows across the full Product ACL
scope. Its included duplicate summaries cover 50 groups and 276 row-context
entries:

| Included duplicate summary measure | Count |
| --- | ---: |
| Product-only shared-drive groups | 49 |
| Group spanning My Drive and shared drive | 1 |
| Group containing unassigned rows | 1 |
| Groups needing owner review | 50 |
| Candidate owner `product` | 50 |

Largest included duplicate groups:

| Duplicate group | Rows | Owners | Roots | Note |
| --- | ---: | --- | --- | --- |
| `dup_18fa26fa74685c3b` | 35 | `product` | `shared_drive` | product-only duplicate review |
| `dup_e3b0c44298fc1c14` | 31 | `_unassigned`, `product` | `my_drive`, `shared_drive` | coordinate with unassigned duplicate review |
| `dup_4eb67e1ecdb6423e` | 7 | `product` | `shared_drive` | product-only duplicate review |
| `dup_645074bc723d28e6` | 7 | `product` | `shared_drive` | product-only duplicate review |
| `dup_789561d774f8fe26` | 7 | `product` | `shared_drive` | product-only duplicate review |

Do not mark duplicate survivors or exceptions from this ACL packet alone.
Duplicate decisions remain under duplicate gate `c1b639c8`, with product packet
prep recorded in `docs/open-files-duplicate-product-review-prep-2026-06-09.md`.

## Review Lane

This queue has two separate decisions:

1. Owner/reviewer ACL approval for shared-drive Product rows.
2. Duplicate survivor or exception decisions for same-content rows.

Do not collapse those decisions. ACL approval can confirm permission scope and
risk handling, but it does not by itself prove duplicate rows should be marked
as true duplicates.

Reviewer guidance:

1. Review product media-heavy assets separately from document-style assets. The
   largest byte drivers are RAW images, videos, ZIPs, and Photoshop files.
2. Coordinate `dup_e3b0c44298fc1c14` with unassigned duplicate task `62a7ecf3`
   before any survivor or duplicate decision.
3. Keep all 6,242 rows at `acl_review_status = needs_review` and
   `permission_risk = unknown` until approval gate `drive-acl-owner-approval`
   on task `e4cb7380` is recorded.
4. After approved ACL updates, push `file_organization_reviews` and
   `file_organization_events` to canonical Postgres and export evidence.
5. Do not mark rows moved or rewrite canonical S3 object keys in this task.

Recommended command patterns:

```bash
bun src/cli/index.tsx organize approval-packet --root-type shared_drive --owner product --sample-limit 100 --duplicate-limit 50 --output <private-packet.json>
bun src/cli/index.tsx organize list --root-type shared_drive --owner product --acl-status needs_review --limit 100 --json
bun src/cli/index.tsx organize duplicates --root-type shared_drive --owner product --limit 50 --json
```

Only after owner/reviewer approval should `organize review` be used for ACL
status, permission scope, or permission risk updates.
