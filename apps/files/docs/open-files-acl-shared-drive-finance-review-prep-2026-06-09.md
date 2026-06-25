# Open Files Shared-Drive Finance ACL Review Prep - 2026-06-09

Scope: read-only preparation for task `d417db6d`, the shared-drive Finance ACL
approval packet.

This document does not approve ACLs, change `acl_review_status`,
`permission_scope`, or `permission_risk`, mark duplicates, mark files moved,
rewrite S3 keys, or change canonical Postgres.

Source packet:

```txt
local: /home/hasna/.hasna/files/open-files-acl-approval-packets-20260609T051621+0300/shared_drive-finance-acl-approval-packet.json
packet sha256: 6c5398c270e70682fde6f62fa9f8c7ff73b38302ed7daa0a2fb1775a437b9bb7
s3 asset: asset_544ff24ee4b74b07
s3 archive: s3://hasna-xyz-opensource-files-prod/orgs/hasna-xyz/companies/_global/open-files/2026/06/drive-acl-approval-packets/asset_544ff24ee4b74b07/open-files-acl-approval-packets-20260609T051621-0300.tar.gz
archive sha256: f2a714c64d9c0098de816d3b58ae303377776b02e670a85134f4c26ac6a72449
generated at: 2026-06-09T02:16:21.954Z
```

## Packet Shape

| Measure | Count |
| --- | ---: |
| Rows | 3,299 |
| Total bytes | 1,305,772,249 |
| Duplicate-overlap rows | 542 |
| Unassigned rows | 0 |
| Missing-target rows | 0 |
| Sample rows in packet | 100 |
| Duplicate group summaries in packet | 50 |
| Rows represented by included duplicate summaries | 157 |

All rows in the packet currently have:

| Field | Value | Count |
| --- | --- | ---: |
| `review_status` | `in_review` | 3,299 |
| `acl_review_status` | `needs_review` | 3,299 |
| `permission_scope` | `shared_drive` | 3,299 |
| `permission_risk` | `unknown` | 3,299 |
| top-level folder | `Finance` | 3,299 |

## 2026-06-11 Read-Only Re-Audit

Task `277c243f` recomputed the shared-drive Finance ACL lane from the local
review database without printing file names, paths, object keys, ACL payloads,
or changing review rows. The packet shape still matches this document: 3,299
rows, 1,305,772,249 bytes, 542 duplicate-overlap rows, zero unassigned rows,
and zero missing-target rows. All 3,299 rows still have `acl_review_status =
needs_review`, `permission_scope = shared_drive`, and `permission_risk =
unknown`. No rows in this lane are marked moved or duplicate.

The full current lane contains 346 distinct duplicate groups behind the 542
duplicate-overlap rows; the original reviewer packet included summaries for 50
of those groups. Duplicate survivor decisions remain outside this ACL lane.

The same audit verified the task-local `drive-acl-owner-approval` checkpoint is
still pending and has not been completed.

Evidence:

| Artifact | Lines | SHA-256 |
| --- | ---: | --- |
| `/tmp/open-files-shared-drive-finance-acl-aggregate-audit-2026-06-11.tsv` | 22 | `471afba817bd98e5dbc4b7e668767dfe5e8f68a2d29c21377d07e65ca9f87493` |

## File Shape

| MIME type | Rows | Bytes |
| --- | ---: | ---: |
| `application/pdf` | 2,706 | 1,053,563,341 |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | 176 | 40,580,898 |
| `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | 149 | 16,812,555 |
| `text/csv` | 111 | 70,027 |
| `image/jpeg` | 59 | 30,630,145 |
| `image/png` | 30 | 12,661,101 |
| `application/zip` | 7 | 84,758,954 |
| `application/x-7z-compressed` | 6 | 53,246,411 |

## Duplicate Context

The packet reports 542 duplicate-overlap rows across the full Finance ACL scope.
The included duplicate summaries cover 50 groups and 157 row-context entries:

| Included duplicate summary measure | Count |
| --- | ---: |
| Finance-only groups | 35 |
| Finance/legal groups | 15 |
| Groups containing unassigned rows | 0 |
| Groups needing owner review | 50 |
| Candidate owner `finance` | 50 |

Largest included duplicate groups:

| Duplicate group | Rows | Owners | Note |
| --- | ---: | --- | --- |
| `dup_975a63deb557058a` | 30 | `finance` | finance-only duplicate review |
| `dup_97daef1f48c0c584` | 9 | `finance`, `legal` | cross-owner finance/legal review |
| `dup_2ba55f59a79d42a3` | 4 | `finance`, `legal` | cross-owner finance/legal review |

Do not mark duplicate survivors or exceptions from this ACL packet alone.
Duplicate decisions remain under duplicate gate `c1b639c8`, with finance
duplicate prep recorded in
`docs/open-files-duplicate-finance-review-prep-2026-06-09.md`.

## Review Lane

Reviewer guidance:

1. Start with finance/legal duplicate overlap before ACL approval because legal
   context may change the permission-risk decision.
2. Treat all 3,299 rows as pending until `drive-acl-owner-approval` on task
   `d417db6d` is recorded.
3. Keep rows at `acl_review_status = needs_review` and `permission_risk =
   unknown` until approved.
4. After approved ACL updates, push `file_organization_reviews` and
   `file_organization_events` to canonical Postgres and export evidence.
5. Do not mark rows moved or rewrite canonical S3 object keys in this task.

Recommended command patterns:

```bash
bun src/cli/index.tsx organize approval-packet --root-type shared_drive --owner finance --sample-limit 100 --duplicate-limit 50 --output <private-packet.json>
bun src/cli/index.tsx organize list --root-type shared_drive --owner finance --acl-status needs_review --limit 100 --json
bun src/cli/index.tsx organize duplicates --root-type shared_drive --owner finance --limit 50 --json
```

Only after owner/reviewer approval should `organize review` be used for ACL
status, permission scope, or permission risk updates.
