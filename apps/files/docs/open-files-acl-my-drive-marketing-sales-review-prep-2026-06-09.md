# Open Files My Drive Marketing-Sales ACL Review Prep - 2026-06-09

Scope: read-only preparation for task `c857dbc2`, the My Drive Marketing/Sales
ACL approval packet.

This document does not approve ACLs, change `acl_review_status`,
`permission_scope`, or `permission_risk`, mark duplicates, mark files moved,
rewrite S3 keys, or change canonical Postgres.

This packet covers owner-known My Drive rows only. It does not include the 1,667
post-unassigned My Drive rows that remain blocked behind task `988a1e81`.

Source packet:

```txt
local: /home/hasna/.hasna/files/open-files-acl-approval-packets-20260609T051621+0300/my_drive-marketing-sales-acl-approval-packet.json
packet sha256: 818dee5ae509e9bbd2eca3b53b5e3c9523d930800a1bb78a113447d7a3d1a922
s3 asset: asset_544ff24ee4b74b07
s3 archive: s3://hasna-xyz-opensource-files-prod/orgs/hasna-xyz/companies/_global/open-files/2026/06/drive-acl-approval-packets/asset_544ff24ee4b74b07/open-files-acl-approval-packets-20260609T051621-0300.tar.gz
archive sha256: f2a714c64d9c0098de816d3b58ae303377776b02e670a85134f4c26ac6a72449
generated at: 2026-06-09T02:16:23.121Z
```

## Packet Shape

| Measure | Count |
| --- | ---: |
| Rows | 2,240 |
| Total bytes | 18,715,609,300 |
| Duplicate-overlap rows | 218 |
| Unassigned rows | 0 |
| Missing-target rows | 0 |
| Sample rows in packet | 100 |
| Duplicate group summaries in packet | 50 |
| Rows represented by included duplicate summaries | 103 |

All rows in the packet currently have:

| Field | Value | Count |
| --- | --- | ---: |
| `review_status` | `in_review` | 2,240 |
| `acl_review_status` | `needs_review` | 2,240 |
| `permission_scope` | `private` | 2,240 |
| `permission_risk` | `unknown` | 2,240 |

## 2026-06-11 Read-Only Re-Audit

Task `b40de4c6` recomputed the My Drive Marketing/Sales ACL lane from the local
review database without printing file names, paths, object keys, ACL payloads,
or changing review rows. The packet shape still matches this document: 2,240
rows, 18,715,609,300 bytes, 218 duplicate-overlap rows, zero unassigned rows,
and zero missing-target rows. All 2,240 rows still have `acl_review_status =
needs_review`, `permission_scope = private`, and `permission_risk = unknown`.
No rows in this lane are marked moved or duplicate.

The same audit verified the task-local `drive-acl-owner-approval` checkpoint is
still pending and has not been completed.

Evidence:

| Artifact | Lines | SHA-256 |
| --- | ---: | --- |
| `/tmp/open-files-my-drive-marketing-sales-acl-aggregate-audit-2026-06-11.tsv` | 16 | `4c6b0fdeefb2da4abde4e347b9e34cad7eb4897ba6e351963e4ed1cf36470c75` |

Top-level folders:

| Top level | Rows | Bytes |
| --- | ---: | ---: |
| `Shootings` | 2,114 | 14,818,948,046 |
| `Beep Media Deliverables` | 85 | 94,444,360 |
| `Content & Marketing` | 33 | 1,349,390,204 |
| `MW VisiSharp German Content - Beep Media` | 6 | 2,309,843,739 |
| `Creatives Examples` | 2 | 142,982,951 |

## File Shape

| MIME type | Rows | Bytes |
| --- | ---: | ---: |
| `image/jpeg` | 2,137 | 9,627,842,113 |
| `video/quicktime` | 18 | 6,554,209,697 |
| `video/mp4` | 2 | 2,431,618,955 |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | 33 | 10,372,506 |
| `image/png` | 12 | 2,438,758 |
| `application/x-font-otf` | 10 | 867,704 |
| `application/x-font-ttf` | 10 | 3,624,612 |
| `application/postscript` | 9 | 5,601,114 |

## Duplicate Context

The packet reports 218 duplicate-overlap rows across the full Marketing/Sales
ACL scope. Included duplicate summaries cover 50 groups and 103 row-context
entries:

| Included duplicate summary measure | Count |
| --- | ---: |
| Marketing-sales-only groups | 16 |
| `_unassigned`/marketing-sales groups | 15 |
| Marketing-sales/product groups | 19 |
| Groups spanning My Drive and shared drive | 19 |
| Groups containing unassigned rows | 15 |
| Candidate owner `marketing-sales` | 31 |
| Candidate owner `product` | 19 |

Coordinate unassigned duplicate groups through `62a7ecf3` and product overlaps
through duplicate gate `c1b639c8` before survivor or exception decisions.

## Review Lane

Reviewer guidance:

1. Treat this as a private My Drive media-heavy marketing packet; most rows are
   in `Shootings`.
2. Keep all 2,240 rows at `acl_review_status = needs_review` and
   `permission_risk = unknown` until `drive-acl-owner-approval` on task
   `c857dbc2` is recorded.
3. Coordinate duplicate decisions through `c1b639c8`; ACL approval does not
   decide duplicate survivor state.
4. After approved ACL updates, push `file_organization_reviews` and
   `file_organization_events` to canonical Postgres and export evidence.
5. Do not mark rows moved or rewrite canonical S3 object keys in this task.

Recommended command patterns:

```bash
bun src/cli/index.tsx organize approval-packet --root-type my_drive --owner marketing-sales --sample-limit 100 --duplicate-limit 50 --output <private-packet.json>
bun src/cli/index.tsx organize list --root-type my_drive --owner marketing-sales --acl-status needs_review --limit 100 --json
bun src/cli/index.tsx organize duplicates --root-type my_drive --owner marketing-sales --limit 50 --json
```

Only after owner/reviewer approval should `organize review` be used for ACL
status, permission scope, or permission risk updates.
