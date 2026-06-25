# Open Files My Drive People ACL Review Prep - 2026-06-09

Scope: read-only preparation for task `b054dcf6`, the My Drive People ACL
approval packet.

This document does not approve ACLs, change `acl_review_status`,
`permission_scope`, or `permission_risk`, mark duplicates, mark files moved,
rewrite S3 keys, or change canonical Postgres.

This packet covers owner-known My Drive rows only. It does not include the 1,667
post-unassigned My Drive rows that remain blocked behind task `988a1e81`.

Source packet:

```txt
local: /home/hasna/.hasna/files/open-files-acl-approval-packets-20260609T051621+0300/my_drive-people-acl-approval-packet.json
packet sha256: b82321adcd5182871bf00be236ef3d8f9e45715ddca970ba0c5338146b642d17
s3 asset: asset_544ff24ee4b74b07
s3 archive: s3://hasna-xyz-opensource-files-prod/orgs/hasna-xyz/companies/_global/open-files/2026/06/drive-acl-approval-packets/asset_544ff24ee4b74b07/open-files-acl-approval-packets-20260609T051621-0300.tar.gz
archive sha256: f2a714c64d9c0098de816d3b58ae303377776b02e670a85134f4c26ac6a72449
generated at: 2026-06-09T02:16:23.343Z
```

## Packet Shape

| Measure | Count |
| --- | ---: |
| Rows | 1,537 |
| Total bytes | 1,917,627,289 |
| Duplicate-overlap rows | 162 |
| Unassigned rows | 0 |
| Missing-target rows | 0 |
| Sample rows in packet | 100 |
| Duplicate group summaries in packet | 50 |
| Rows represented by included duplicate summaries | 111 |

All rows in the packet currently have:

| Field | Value | Count |
| --- | --- | ---: |
| `review_status` | `in_review` | 1,537 |
| `acl_review_status` | `needs_review` | 1,537 |
| `permission_scope` | `private` | 1,537 |
| `permission_risk` | `unknown` | 1,537 |
| top-level folder | `HR & People` | 1,537 |

## 2026-06-11 Read-Only Re-Audit

Task `cb4f3a27` recomputed the My Drive People ACL lane from the local review
database without printing file names, paths, object keys, ACL payloads, or
changing review rows. The packet shape still matches this document: 1,537 rows,
1,917,627,289 bytes, 162 duplicate-overlap rows, zero unassigned rows, and zero
missing-target rows. All 1,537 rows still have `acl_review_status =
needs_review`, `permission_scope = private`, and `permission_risk = unknown`.
No rows in this lane are marked moved or duplicate.

The same audit verified the task-local `drive-acl-owner-approval` checkpoint is
still pending and has not been completed.

Evidence:

| Artifact | Lines | SHA-256 |
| --- | ---: | --- |
| `/tmp/open-files-my-drive-people-acl-aggregate-audit-2026-06-11.tsv` | 16 | `ce47af0d063563f1a0169325fbb26d9e841664af8b4323ebc3903a8c073da084` |

## File Shape

| MIME type | Rows | Bytes |
| --- | ---: | ---: |
| `application/pdf` | 904 | 1,699,212,778 |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | 458 | 105,575,711 |
| `image/jpeg` | 79 | 89,294,274 |
| `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | 65 | 6,282,409 |
| `application/msword` | 14 | 1,704,960 |
| `text/rtf` | 6 | 385,886 |
| `image/png` | 5 | 8,292,161 |

## Duplicate Context

The packet reports 162 duplicate-overlap rows across the full People ACL scope.
Included duplicate summaries cover 50 groups and 111 row-context entries:

| Included duplicate summary measure | Count |
| --- | ---: |
| People-only groups | 46 |
| Finance/people groups | 3 |
| People/workspace groups | 1 |
| Groups spanning My Drive and shared drive | 35 |
| Groups containing unassigned rows | 0 |
| Candidate owner `people` | 47 |
| Candidate owner `finance` | 3 |

Do not mark duplicate survivors or exceptions from this ACL packet alone.
Duplicate decisions remain under duplicate gate `c1b639c8`, with people
duplicate prep recorded in
`docs/open-files-duplicate-people-review-prep-2026-06-09.md`.

## Review Lane

Reviewer guidance:

1. Treat private My Drive HR/people records as permission-risk sensitive until
   owner approval is recorded.
2. Review finance/people and people/workspace overlap before applying ACL risk
   decisions that depend on ownership.
3. Keep all 1,537 rows at `acl_review_status = needs_review` and
   `permission_risk = unknown` until `drive-acl-owner-approval` on task
   `b054dcf6` is recorded.
4. After approved ACL updates, push `file_organization_reviews` and
   `file_organization_events` to canonical Postgres and export evidence.
5. Do not mark rows moved or rewrite canonical S3 object keys in this task.

Recommended command patterns:

```bash
bun src/cli/index.tsx organize approval-packet --root-type my_drive --owner people --sample-limit 100 --duplicate-limit 50 --output <private-packet.json>
bun src/cli/index.tsx organize list --root-type my_drive --owner people --acl-status needs_review --limit 100 --json
bun src/cli/index.tsx organize duplicates --root-type my_drive --owner people --limit 50 --json
```

Only after owner/reviewer approval should `organize review` be used for ACL
status, permission scope, or permission risk updates.
