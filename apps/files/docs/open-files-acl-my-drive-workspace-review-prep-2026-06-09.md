# Open Files My Drive Workspace ACL Review Prep - 2026-06-09

Scope: read-only preparation for task `95ab0a9f`, the My Drive Workspace ACL
approval packet.

This document does not approve ACLs, change `acl_review_status`,
`permission_scope`, or `permission_risk`, mark duplicates, mark files moved,
rewrite S3 keys, or change canonical Postgres.

This packet covers owner-known My Drive rows only. It does not include the 1,667
post-unassigned My Drive rows that remain blocked behind task `988a1e81`.

Source packet:

```txt
local: /home/hasna/.hasna/files/open-files-acl-approval-packets-20260609T051621+0300/my_drive-workspace-acl-approval-packet.json
packet sha256: 8b3d6e3994278e629a7c377b5e9a24c63bea1a61af540119e721f38f10427b3a
s3 asset: asset_544ff24ee4b74b07
s3 archive: s3://hasna-xyz-opensource-files-prod/orgs/hasna-xyz/companies/_global/open-files/2026/06/drive-acl-approval-packets/asset_544ff24ee4b74b07/open-files-acl-approval-packets-20260609T051621-0300.tar.gz
archive sha256: f2a714c64d9c0098de816d3b58ae303377776b02e670a85134f4c26ac6a72449
generated at: 2026-06-09T02:16:23.808Z
```

## Packet Shape

| Measure | Count |
| --- | ---: |
| Rows | 119 |
| Total bytes | 52,226,269 |
| Duplicate-overlap rows | 12 |
| Unassigned rows | 0 |
| Missing-target rows | 0 |
| Sample rows in packet | 100 |
| Duplicate group summaries in packet | 8 |
| Rows represented by included duplicate summaries | 18 |

All rows in the packet currently have:

| Field | Value | Count |
| --- | --- | ---: |
| `review_status` | `in_review` | 119 |
| `acl_review_status` | `needs_review` | 119 |
| `permission_scope` | `private` | 119 |
| `permission_risk` | `unknown` | 119 |
| top-level folder | `Business Operations` | 119 |

## 2026-06-11 Read-Only Re-Audit

Task `4c7da031` recomputed the My Drive Workspace ACL lane from the local
review database without printing file names, paths, object keys, ACL payloads,
or changing review rows. The packet shape still matches this document: 119
rows, 52,226,269 bytes, 12 duplicate-overlap rows, 8 distinct duplicate groups,
zero unassigned rows, and zero missing-target rows. All 119 rows still have
`acl_review_status = needs_review`, `permission_scope = private`, and
`permission_risk = unknown`. No rows in this lane are marked moved or duplicate.

The same audit verified the task-local `drive-acl-owner-approval` checkpoint is
still pending and has not been completed.

Evidence:

| Artifact | Lines | SHA-256 |
| --- | ---: | --- |
| `/tmp/open-files-my-drive-workspace-acl-aggregate-audit-2026-06-11.tsv` | 16 | `ba91ea781b52ade19df9297a67b699e40c835b2ad143047fce814666108ae69d` |

## File Shape

| MIME type | Rows | Bytes |
| --- | ---: | ---: |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | 71 | 25,442,333 |
| `application/pdf` | 37 | 26,377,375 |
| `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | 7 | 278,049 |
| `application/msword` | 4 | 128,512 |

## Duplicate Context

The packet reports 12 duplicate-overlap rows across the full Workspace ACL
scope. Included duplicate summaries cover 8 groups and 18 row-context entries:

| Included duplicate summary measure | Count |
| --- | ---: |
| Workspace-only groups | 2 |
| People/workspace groups | 4 |
| Finance/workspace groups | 2 |
| Groups spanning My Drive and shared drive | 2 |
| Groups containing unassigned rows | 0 |
| Candidate owner `workspace` | 2 |
| Candidate owner `people` | 4 |
| Candidate owner `finance` | 2 |

Do not mark duplicate survivors or exceptions from this ACL packet alone.
Duplicate decisions remain under duplicate gate `c1b639c8`, with workspace
duplicate prep recorded in
`docs/open-files-duplicate-workspace-review-prep-2026-06-09.md`.

## Review Lane

Reviewer guidance:

1. Review people/workspace and finance/workspace overlaps before applying ACL
   risk decisions that depend on owner context.
2. Keep all 119 rows at `acl_review_status = needs_review` and
   `permission_risk = unknown` until `drive-acl-owner-approval` on task
   `95ab0a9f` is recorded.
3. Coordinate duplicate decisions through `c1b639c8`; ACL approval does not
   decide duplicate survivor state.
4. After approved ACL updates, push `file_organization_reviews` and
   `file_organization_events` to canonical Postgres and export evidence.
5. Do not mark rows moved or rewrite canonical S3 object keys in this task.

Recommended command patterns:

```bash
bun src/cli/index.tsx organize approval-packet --root-type my_drive --owner workspace --sample-limit 100 --duplicate-limit 50 --output <private-packet.json>
bun src/cli/index.tsx organize list --root-type my_drive --owner workspace --acl-status needs_review --limit 100 --json
bun src/cli/index.tsx organize duplicates --root-type my_drive --owner workspace --limit 50 --json
```

Only after owner/reviewer approval should `organize review` be used for ACL
status, permission scope, or permission risk updates.
