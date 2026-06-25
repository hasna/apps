# Open Files Shared-Drive People ACL Review Prep - 2026-06-09

Scope: read-only preparation for task `198f4cbe`, the shared-drive People ACL
approval packet.

This document does not approve ACLs, change `acl_review_status`,
`permission_scope`, or `permission_risk`, mark duplicates, mark files moved,
rewrite S3 keys, or change canonical Postgres.

Source packet:

```txt
local: /home/hasna/.hasna/files/open-files-acl-approval-packets-20260609T051621+0300/shared_drive-people-acl-approval-packet.json
packet sha256: 29997e2f3f247031eea965f49eaaaf6a0ac8c37e2641c62b0a9b3380f234bb2e
s3 asset: asset_544ff24ee4b74b07
s3 archive: s3://hasna-xyz-opensource-files-prod/orgs/hasna-xyz/companies/_global/open-files/2026/06/drive-acl-approval-packets/asset_544ff24ee4b74b07/open-files-acl-approval-packets-20260609T051621-0300.tar.gz
archive sha256: f2a714c64d9c0098de816d3b58ae303377776b02e670a85134f4c26ac6a72449
generated at: 2026-06-09T02:16:22.193Z
```

## Packet Shape

| Measure | Count |
| --- | ---: |
| Rows | 1,415 |
| Total bytes | 1,219,418,871 |
| Duplicate-overlap rows | 261 |
| Unassigned rows | 0 |
| Missing-target rows | 0 |
| Sample rows in packet | 100 |
| Duplicate group summaries in packet | 50 |
| Rows represented by included duplicate summaries | 112 |

All rows in the packet currently have:

| Field | Value | Count |
| --- | --- | ---: |
| `review_status` | `in_review` | 1,415 |
| `acl_review_status` | `needs_review` | 1,415 |
| `permission_scope` | `shared_drive` | 1,415 |
| `permission_risk` | `unknown` | 1,415 |
| top-level folder | `People` | 1,415 |

## 2026-06-11 Read-Only Re-Audit

Task `541c0670` recomputed the shared-drive People ACL lane from the local
review database without printing file names, paths, object keys, ACL payloads,
or changing review rows. The packet shape still matches this document: 1,415
rows, 1,219,418,871 bytes, 261 duplicate-overlap rows, zero unassigned rows,
and zero missing-target rows. All 1,415 rows still have `acl_review_status =
needs_review`, `permission_scope = shared_drive`, and `permission_risk =
unknown`. No rows in this lane are marked moved or duplicate.

The full current lane contains 214 distinct duplicate groups behind the 261
duplicate-overlap rows; the original reviewer packet included summaries for 50
of those groups. Duplicate survivor decisions remain outside this ACL lane.

The same audit verified the task-local `drive-acl-owner-approval` checkpoint is
still pending and has not been completed.

Evidence:

| Artifact | Lines | SHA-256 |
| --- | ---: | --- |
| `/tmp/open-files-shared-drive-people-acl-aggregate-audit-2026-06-11.tsv` | 16 | `d505f6c4f2cfdbd5965311da067125012791a906e2ceb28a619283dc8070bb84` |

## File Shape

| MIME type | Rows | Bytes |
| --- | ---: | ---: |
| `application/pdf` | 657 | 666,039,310 |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | 481 | 174,007,065 |
| `image/jpeg` | 124 | 132,676,587 |
| `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | 113 | 15,490,815 |
| `application/msword` | 14 | 1,203,505 |
| `image/heif` | 7 | 13,755,102 |
| `video/mp4` | 6 | 204,530,236 |

## Duplicate Context

The packet reports 261 duplicate-overlap rows across the full People ACL scope.
The included duplicate summaries cover 50 groups and 112 row-context entries:

| Included duplicate summary measure | Count |
| --- | ---: |
| People-only groups | 49 |
| Legal/people groups | 1 |
| Groups spanning My Drive and shared drive | 14 |
| Groups containing unassigned rows | 0 |
| Candidate owner `people` | 49 |
| Candidate owner `legal` | 1 |

Do not mark duplicate survivors or exceptions from this ACL packet alone.
Duplicate decisions remain under duplicate gate `c1b639c8`, with people
duplicate prep recorded in
`docs/open-files-duplicate-people-review-prep-2026-06-09.md`.

## Review Lane

Reviewer guidance:

1. Review cross-root People groups carefully; a My Drive/shared-drive match does
   not prove either row is a disposable duplicate.
2. Treat employee, people-ops, and HR-adjacent files as permission-risk sensitive
   until owner approval is recorded.
3. Keep all 1,415 rows at `acl_review_status = needs_review` and
   `permission_risk = unknown` until `drive-acl-owner-approval` on task
   `198f4cbe` is recorded.
4. After approved ACL updates, push `file_organization_reviews` and
   `file_organization_events` to canonical Postgres and export evidence.
5. Do not mark rows moved or rewrite canonical S3 object keys in this task.

Recommended command patterns:

```bash
bun src/cli/index.tsx organize approval-packet --root-type shared_drive --owner people --sample-limit 100 --duplicate-limit 50 --output <private-packet.json>
bun src/cli/index.tsx organize list --root-type shared_drive --owner people --acl-status needs_review --limit 100 --json
bun src/cli/index.tsx organize duplicates --root-type shared_drive --owner people --limit 50 --json
```

Only after owner/reviewer approval should `organize review` be used for ACL
status, permission scope, or permission risk updates.
