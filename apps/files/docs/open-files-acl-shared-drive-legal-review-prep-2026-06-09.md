# Open Files Shared-Drive Legal ACL Review Prep - 2026-06-09

Scope: read-only preparation for task `12163ddc`, the shared-drive Legal ACL
approval packet.

This document does not approve ACLs, change `acl_review_status`,
`permission_scope`, or `permission_risk`, mark duplicates, mark files moved,
rewrite S3 keys, or change canonical Postgres.

Source packet:

```txt
local: /home/hasna/.hasna/files/open-files-acl-approval-packets-20260609T051621+0300/shared_drive-legal-acl-approval-packet.json
packet sha256: d4ac5a56504eac6c283657912a32a7a2fe78ed672e79c77aaa588fb5da93dcaa
s3 asset: asset_544ff24ee4b74b07
s3 archive: s3://hasna-xyz-opensource-files-prod/orgs/hasna-xyz/companies/_global/open-files/2026/06/drive-acl-approval-packets/asset_544ff24ee4b74b07/open-files-acl-approval-packets-20260609T051621-0300.tar.gz
archive sha256: f2a714c64d9c0098de816d3b58ae303377776b02e670a85134f4c26ac6a72449
generated at: 2026-06-09T02:16:22.434Z
```

## Packet Shape

| Measure | Count |
| --- | ---: |
| Rows | 729 |
| Total bytes | 773,831,274 |
| Duplicate-overlap rows | 418 |
| Unassigned rows | 0 |
| Missing-target rows | 0 |
| Sample rows in packet | 100 |
| Duplicate group summaries in packet | 50 |
| Rows represented by included duplicate summaries | 174 |

All rows in the packet currently have:

| Field | Value | Count |
| --- | --- | ---: |
| `review_status` | `in_review` | 729 |
| `acl_review_status` | `needs_review` | 729 |
| `permission_scope` | `shared_drive` | 729 |
| `permission_risk` | `unknown` | 729 |
| top-level folder | `Legal` | 729 |

## 2026-06-11 Read-Only Re-Audit

Task `02304ae5` recomputed the shared-drive Legal ACL lane from the local
review database without printing file names, paths, object keys, ACL payloads,
or changing review rows. The packet shape still matches this document: 729
rows, 773,831,274 bytes, 418 duplicate-overlap rows, zero unassigned rows, and
zero missing-target rows. All 729 rows still have `acl_review_status =
needs_review`, `permission_scope = shared_drive`, and `permission_risk =
unknown`. No rows in this lane are marked moved or duplicate.

The full current lane contains 288 distinct duplicate groups behind the 418
duplicate-overlap rows; the original reviewer packet included summaries for 50
of those groups. Duplicate survivor decisions remain outside this ACL lane.

The same audit verified the task-local `drive-acl-owner-approval` checkpoint is
still pending and has not been completed.

Evidence:

| Artifact | Lines | SHA-256 |
| --- | ---: | --- |
| `/tmp/open-files-shared-drive-legal-acl-aggregate-audit-2026-06-11.tsv` | 16 | `81ac47db51a8dd22b6bffae521dba1ffdd7ac483c7e46444e741ec4fa1703b39` |

## File Shape

| MIME type | Rows | Bytes |
| --- | ---: | ---: |
| `application/pdf` | 466 | 642,653,829 |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | 146 | 25,545,373 |
| `image/jpeg` | 37 | 32,731,172 |
| `image/heif` | 27 | 23,175,554 |
| `application/vnd.ms-excel` | 14 | 332,264 |
| `application/x-zip-compressed` | 8 | 35,592,550 |
| `application/zip` | 8 | 2,177,744 |

## Duplicate Context

The packet reports 418 duplicate-overlap rows across the full Legal ACL scope.
The included duplicate summaries cover 50 groups and 174 row-context entries:

| Included duplicate summary measure | Count |
| --- | ---: |
| Legal-only groups | 22 |
| Finance/legal groups | 28 |
| Groups containing unassigned rows | 0 |
| Candidate owner `legal` | 22 |
| Candidate owner `finance` | 28 |

Largest included duplicate groups:

| Duplicate group | Rows | Owners | Note |
| --- | ---: | --- | --- |
| `dup_97daef1f48c0c584` | 9 | `finance`, `legal` | finance/legal review |
| `dup_67881176f3d9b580` | 6 | `legal` | legal-only duplicate review |
| `dup_34588c240cbb2751` | 5 | `finance`, `legal` | finance/legal review |

Do not mark duplicate survivors or exceptions from this ACL packet alone.
Duplicate decisions remain under duplicate gate `c1b639c8`, with legal
duplicate prep recorded in
`docs/open-files-duplicate-legal-review-prep-2026-06-09.md`.

## Review Lane

Reviewer guidance:

1. Start with finance/legal overlap before ACL approval, since finance-owned
   candidates may still carry legal confidentiality constraints.
2. Treat all Legal rows as permission-risk sensitive until owner approval is
   recorded.
3. Keep all 729 rows at `acl_review_status = needs_review` and
   `permission_risk = unknown` until `drive-acl-owner-approval` on task
   `12163ddc` is recorded.
4. After approved ACL updates, push `file_organization_reviews` and
   `file_organization_events` to canonical Postgres and export evidence.
5. Do not mark rows moved or rewrite canonical S3 object keys in this task.

Recommended command patterns:

```bash
bun src/cli/index.tsx organize approval-packet --root-type shared_drive --owner legal --sample-limit 100 --duplicate-limit 50 --output <private-packet.json>
bun src/cli/index.tsx organize list --root-type shared_drive --owner legal --acl-status needs_review --limit 100 --json
bun src/cli/index.tsx organize duplicates --root-type shared_drive --owner legal --limit 50 --json
```

Only after owner/reviewer approval should `organize review` be used for ACL
status, permission scope, or permission risk updates.
