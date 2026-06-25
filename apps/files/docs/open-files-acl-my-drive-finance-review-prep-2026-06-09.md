# Open Files My Drive Finance ACL Review Prep - 2026-06-09

Scope: read-only preparation for task `2b00315b`, the My Drive Finance ACL
approval packet.

This document does not approve ACLs, change `acl_review_status`,
`permission_scope`, or `permission_risk`, mark duplicates, mark files moved,
rewrite S3 keys, or change canonical Postgres.

This packet covers owner-known My Drive rows only. It does not include the 1,667
post-unassigned My Drive rows that remain blocked behind task `988a1e81`.

Source packet:

```txt
local: /home/hasna/.hasna/files/open-files-acl-approval-packets-20260609T051621+0300/my_drive-finance-acl-approval-packet.json
packet sha256: 1b532a9aa0276a29ab2715990a2e4e34fa829e571b3916271da112e09a711a60
s3 asset: asset_544ff24ee4b74b07
s3 archive: s3://hasna-xyz-opensource-files-prod/orgs/hasna-xyz/companies/_global/open-files/2026/06/drive-acl-approval-packets/asset_544ff24ee4b74b07/open-files-acl-approval-packets-20260609T051621-0300.tar.gz
archive sha256: f2a714c64d9c0098de816d3b58ae303377776b02e670a85134f4c26ac6a72449
generated at: 2026-06-09T02:16:23.583Z
```

## Packet Shape

| Measure | Count |
| --- | ---: |
| Rows | 406 |
| Total bytes | 91,433,262 |
| Duplicate-overlap rows | 116 |
| Unassigned rows | 0 |
| Missing-target rows | 0 |
| Sample rows in packet | 100 |
| Duplicate group summaries in packet | 50 |
| Rows represented by included duplicate summaries | 103 |

All rows in the packet currently have:

| Field | Value | Count |
| --- | --- | ---: |
| `review_status` | `in_review` | 406 |
| `acl_review_status` | `needs_review` | 406 |
| `permission_scope` | `private` | 406 |
| `permission_risk` | `unknown` | 406 |
| top-level folder | `Finance` | 406 |

## 2026-06-11 Read-Only Re-Audit

Task `70b6f2cc` recomputed the My Drive Finance ACL lane from the local review
database without printing file names, paths, object keys, ACL payloads, or
changing review rows. The packet shape still matches this document: 406 rows,
91,433,262 bytes, 116 duplicate-overlap rows, zero unassigned rows, and zero
missing-target rows. All 406 rows still have `acl_review_status =
needs_review`, `permission_scope = private`, and `permission_risk = unknown`.
No rows in this lane are marked moved or duplicate.

The full current lane contains 63 distinct duplicate groups behind the 116
duplicate-overlap rows; the original reviewer packet included summaries for 50
of those groups. Duplicate survivor decisions remain outside this ACL lane.

The same audit verified the task-local `drive-acl-owner-approval` checkpoint is
still pending and has not been completed.

Evidence:

| Artifact | Lines | SHA-256 |
| --- | ---: | --- |
| `/tmp/open-files-my-drive-finance-acl-aggregate-audit-2026-06-11.tsv` | 16 | `5bafeeeae8993eb0aac5fc16f033dc2725d6942bf592e81c5d0f244b0087922d` |

## File Shape

| MIME type | Rows | Bytes |
| --- | ---: | ---: |
| `application/pdf` | 311 | 56,858,031 |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | 52 | 1,205,990 |
| `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | 18 | 9,710,766 |
| `image/jpeg` | 12 | 16,854,135 |
| `text/csv` | 7 | 155,003 |
| `image/heif` | 3 | 5,985,145 |
| `image/png` | 3 | 664,192 |

## Duplicate Context

The packet reports 116 duplicate-overlap rows across the full Finance ACL scope.
Included duplicate summaries cover 50 groups and 103 row-context entries:

| Included duplicate summary measure | Count |
| --- | ---: |
| Finance-only groups | 50 |
| My Drive-only groups | 50 |
| Groups containing unassigned rows | 0 |
| Candidate owner `finance` | 50 |

Do not mark duplicate survivors or exceptions from this ACL packet alone.
Duplicate decisions remain under duplicate gate `c1b639c8`, with finance
duplicate prep recorded in
`docs/open-files-duplicate-finance-review-prep-2026-06-09.md`.

## Review Lane

Reviewer guidance:

1. Treat private My Drive finance files as permission-risk sensitive until owner
   approval is recorded.
2. Keep all 406 rows at `acl_review_status = needs_review` and
   `permission_risk = unknown` until `drive-acl-owner-approval` on task
   `2b00315b` is recorded.
3. Coordinate duplicate decisions through `c1b639c8`; ACL approval does not
   decide duplicate survivor state.
4. After approved ACL updates, push `file_organization_reviews` and
   `file_organization_events` to canonical Postgres and export evidence.
5. Do not mark rows moved or rewrite canonical S3 object keys in this task.

Recommended command patterns:

```bash
bun src/cli/index.tsx organize approval-packet --root-type my_drive --owner finance --sample-limit 100 --duplicate-limit 50 --output <private-packet.json>
bun src/cli/index.tsx organize list --root-type my_drive --owner finance --acl-status needs_review --limit 100 --json
bun src/cli/index.tsx organize duplicates --root-type my_drive --owner finance --limit 50 --json
```

Only after owner/reviewer approval should `organize review` be used for ACL
status, permission scope, or permission risk updates.
