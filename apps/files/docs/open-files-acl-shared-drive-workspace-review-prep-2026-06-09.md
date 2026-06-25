# Open Files Shared-Drive Workspace ACL Review Prep - 2026-06-09

Scope: read-only preparation for task `92b5f940`, the shared-drive Workspace ACL
approval packet.

This document does not approve ACLs, change `acl_review_status`,
`permission_scope`, or `permission_risk`, mark duplicates, mark files moved,
rewrite S3 keys, or change canonical Postgres.

Source packet:

```txt
local: /home/hasna/.hasna/files/open-files-acl-approval-packets-20260609T051621+0300/shared_drive-workspace-acl-approval-packet.json
packet sha256: 259a9e9d05262b04955ae2849b0f91057d7fe15696d7e8029c50523052147cfe
s3 asset: asset_544ff24ee4b74b07
s3 archive: s3://hasna-xyz-opensource-files-prod/orgs/hasna-xyz/companies/_global/open-files/2026/06/drive-acl-approval-packets/asset_544ff24ee4b74b07/open-files-acl-approval-packets-20260609T051621-0300.tar.gz
archive sha256: f2a714c64d9c0098de816d3b58ae303377776b02e670a85134f4c26ac6a72449
generated at: 2026-06-09T02:16:22.646Z
```

## Packet Shape

| Measure | Count |
| --- | ---: |
| Rows | 463 |
| Total bytes | 222,556,978 |
| Duplicate-overlap rows | 100 |
| Unassigned rows | 0 |
| Missing-target rows | 0 |
| Sample rows in packet | 100 |
| Duplicate group summaries in packet | 50 |
| Rows represented by included duplicate summaries | 105 |

All rows in the packet currently have:

| Field | Value | Count |
| --- | --- | ---: |
| `review_status` | `in_review` | 463 |
| `acl_review_status` | `needs_review` | 463 |
| `permission_scope` | `shared_drive` | 463 |
| `permission_risk` | `unknown` | 463 |
| top-level folder | `Workspace` | 463 |

## 2026-06-11 Read-Only Re-Audit

Task `193bf82a` recomputed the shared-drive Workspace ACL lane from the local
review database without printing file names, paths, object keys, ACL payloads,
or changing review rows. The packet shape still matches this document: 463
rows, 222,556,978 bytes, 100 duplicate-overlap rows, zero unassigned rows, and
zero missing-target rows. All 463 rows still have `acl_review_status =
needs_review`, `permission_scope = shared_drive`, and `permission_risk =
unknown`. No rows in this lane are marked moved or duplicate.

The full current lane contains 54 distinct duplicate groups behind the 100
duplicate-overlap rows; the original reviewer packet included summaries for 50
of those groups. Duplicate survivor decisions remain outside this ACL lane.

The same audit verified the task-local `drive-acl-owner-approval` checkpoint is
still pending and has not been completed.

Evidence:

| Artifact | Lines | SHA-256 |
| --- | ---: | --- |
| `/tmp/open-files-shared-drive-workspace-acl-aggregate-audit-2026-06-11.tsv` | 22 | `c0632307354864d4651f90483e0fbdcc64deec4142f3887ad5ddbf1f47253d6b` |

## File Shape

| MIME type | Rows | Bytes |
| --- | ---: | ---: |
| `application/pdf` | 309 | 167,944,229 |
| `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | 95 | 1,264,507 |
| `application/vnd.ms-excel` | 21 | 1,188,864 |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | 18 | 6,417,134 |
| `text/markdown` | 10 | 107,291 |
| `application/msword` | 5 | 40,285,184 |
| `application/zip` | 1 | 5,210,533 |

## Duplicate Context

The packet reports 100 duplicate-overlap rows across the full Workspace ACL
scope. The included duplicate summaries cover 50 groups and 105 row-context
entries:

| Included duplicate summary measure | Count |
| --- | ---: |
| Workspace-only groups | 41 |
| Finance/workspace groups | 7 |
| `_unassigned`/workspace groups | 2 |
| Groups spanning My Drive and shared drive | 2 |
| Groups containing unassigned rows | 2 |
| Candidate owner `workspace` | 43 |
| Candidate owner `finance` | 7 |

The two unassigned overlap groups are `dup_6b9afedfbbd70308` and
`dup_c9031cd30f9a19c8`. Coordinate them with unassigned duplicate task
`62a7ecf3` before any survivor, exception, or ACL-risk decision that depends on
owner assignment.

Do not mark duplicate survivors or exceptions from this ACL packet alone.
Duplicate decisions remain under duplicate gate `c1b639c8`, with workspace
duplicate prep recorded in
`docs/open-files-duplicate-workspace-review-prep-2026-06-09.md`.

## Review Lane

Reviewer guidance:

1. Start with the two unassigned cross-root groups, then finance/workspace
   overlap.
2. Keep all 463 rows at `acl_review_status = needs_review` and
   `permission_risk = unknown` until `drive-acl-owner-approval` on task
   `92b5f940` is recorded.
3. Coordinate duplicate decisions through `c1b639c8`; ACL approval does not
   decide duplicate survivor state.
4. After approved ACL updates, push `file_organization_reviews` and
   `file_organization_events` to canonical Postgres and export evidence.
5. Do not mark rows moved or rewrite canonical S3 object keys in this task.

Recommended command patterns:

```bash
bun src/cli/index.tsx organize approval-packet --root-type shared_drive --owner workspace --sample-limit 100 --duplicate-limit 50 --output <private-packet.json>
bun src/cli/index.tsx organize list --root-type shared_drive --owner workspace --acl-status needs_review --limit 100 --json
bun src/cli/index.tsx organize duplicates --root-type shared_drive --owner workspace --limit 50 --json
```

Only after owner/reviewer approval should `organize review` be used for ACL
status, permission scope, or permission risk updates.
