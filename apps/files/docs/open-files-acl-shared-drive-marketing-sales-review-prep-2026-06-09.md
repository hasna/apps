# Open Files Shared-Drive Marketing-Sales ACL Review Prep - 2026-06-09

Scope: read-only preparation for task `187bb5fa`, the shared-drive
Marketing/Sales ACL approval packet.

This document does not approve ACLs, change `acl_review_status`,
`permission_scope`, or `permission_risk`, mark duplicates, mark files moved,
rewrite S3 keys, or change canonical Postgres.

Source packet:

```txt
local: /home/hasna/.hasna/files/open-files-acl-approval-packets-20260609T051621+0300/shared_drive-marketing-sales-acl-approval-packet.json
packet sha256: 5a1b106a0932ece476813fe6d00d161c6065a865d245332f4aa590d401a9ce9a
s3 asset: asset_544ff24ee4b74b07
s3 archive: s3://hasna-xyz-opensource-files-prod/orgs/hasna-xyz/companies/_global/open-files/2026/06/drive-acl-approval-packets/asset_544ff24ee4b74b07/open-files-acl-approval-packets-20260609T051621-0300.tar.gz
archive sha256: f2a714c64d9c0098de816d3b58ae303377776b02e670a85134f4c26ac6a72449
generated at: 2026-06-09T02:16:22.891Z
```

## Packet Shape

| Measure | Count |
| --- | ---: |
| Rows | 95 |
| Total bytes | 128,331,941 |
| Duplicate-overlap rows | 93 |
| Unassigned rows | 0 |
| Missing-target rows | 0 |
| Sample rows in packet | 95 |
| Duplicate group summaries in packet | 50 |
| Rows represented by included duplicate summaries | 112 |

All rows in the packet currently have:

| Field | Value | Count |
| --- | --- | ---: |
| `review_status` | `in_review` | 95 |
| `acl_review_status` | `needs_review` | 95 |
| `permission_scope` | `shared_drive` | 95 |
| `permission_risk` | `unknown` | 95 |
| top-level folder | `Marketing & Sales` | 95 |

## 2026-06-11 Read-Only Re-Audit

Task `634ef07a` recomputed the shared-drive Marketing/Sales ACL lane from the
local review database without printing file names, paths, object keys, ACL
payloads, or changing review rows. The packet shape still matches this
document: 95 rows, 128,331,941 bytes, 93 duplicate-overlap rows, zero
unassigned rows, and zero missing-target rows. All 95 rows still have
`acl_review_status = needs_review`, `permission_scope = shared_drive`, and
`permission_risk = unknown`. No rows in this lane are marked moved or
duplicate.

The full current lane contains 81 distinct duplicate groups behind the 93
duplicate-overlap rows; the original reviewer packet included summaries for 50
of those groups. Duplicate survivor decisions remain outside this ACL lane.

The same audit verified the task-local `drive-acl-owner-approval` checkpoint is
still pending and has not been completed.

Evidence:

| Artifact | Lines | SHA-256 |
| --- | ---: | --- |
| `/tmp/open-files-shared-drive-marketing-sales-acl-aggregate-audit-2026-06-11.tsv` | 22 | `eb448bf268b5ca999dd00ca84c52e4f901ee8d5a95a7e332bbde2e6296f6661e` |

## File Shape

| MIME type | Rows | Bytes |
| --- | ---: | ---: |
| `image/png` | 28 | 1,783,151 |
| `application/x-font-ttf` | 19 | 1,828,724 |
| `application/postscript` | 17 | 6,916,938 |
| `image/jpeg` | 13 | 12,929,806 |
| `image/svg+xml` | 12 | 17,846 |
| `application/vnd.openxmlformats-officedocument.presentationml.presentation` | 2 | 26,551,981 |
| `application/x-xfig` | 1 | 77,698,713 |

## Duplicate Context

The packet reports 93 duplicate-overlap rows across the full Marketing/Sales ACL
scope. The included duplicate summaries cover 50 groups and 112 row-context
entries:

| Included duplicate summary measure | Count |
| --- | ---: |
| `_unassigned`/marketing-sales groups | 50 |
| Groups spanning My Drive and shared drive | 50 |
| Groups containing unassigned rows | 50 |
| Candidate owner `marketing-sales` | 50 |

This packet is small but duplicate-heavy: 93 of 95 rows overlap duplicate groups.
All included duplicate summaries require unassigned coordination through
`62a7ecf3` before survivor or exception decisions.

Do not mark duplicate survivors or exceptions from this ACL packet alone.
Duplicate decisions remain under duplicate gate `c1b639c8`, with
marketing-sales duplicate prep recorded in
`docs/open-files-duplicate-marketing-sales-review-prep-2026-06-09.md`.

## Review Lane

Reviewer guidance:

1. Start with duplicate/unassigned coordination; almost every row in this packet
   overlaps duplicate review.
2. Keep all 95 rows at `acl_review_status = needs_review` and
   `permission_risk = unknown` until `drive-acl-owner-approval` on task
   `187bb5fa` is recorded.
3. Coordinate duplicate decisions through `c1b639c8` and unassigned owner review
   through `62a7ecf3`.
4. After approved ACL updates, push `file_organization_reviews` and
   `file_organization_events` to canonical Postgres and export evidence.
5. Do not mark rows moved or rewrite canonical S3 object keys in this task.

Recommended command patterns:

```bash
bun src/cli/index.tsx organize approval-packet --root-type shared_drive --owner marketing-sales --sample-limit 100 --duplicate-limit 50 --output <private-packet.json>
bun src/cli/index.tsx organize list --root-type shared_drive --owner marketing-sales --acl-status needs_review --limit 100 --json
bun src/cli/index.tsx organize duplicates --root-type shared_drive --owner marketing-sales --limit 50 --json
```

Only after owner/reviewer approval should `organize review` be used for ACL
status, permission scope, or permission risk updates.
