# Open Files Workspace Duplicate Review Prep - 2026-06-09

Scope: read-only preparation for task `9025f930`, the duplicate groups that
contain workspace-owned rows.

This document does not assign owners, set target paths, approve ACLs, mark
duplicates, mark files moved, rewrite S3 keys, or change canonical Postgres.

Source packet:

```txt
local: /home/hasna/.hasna/files/open-files-duplicate-review-packets-20260609T052202+0300/workspace.json
packet sha256: 9340cbc5098730f35bca431271d96f33ee656b0de7d7e9cc626ea1c5cb675e2c
s3 asset: asset_b5083d47177f475c
s3 archive: s3://hasna-xyz-opensource-files-prod/orgs/hasna-xyz/companies/_global/open-files/2026/06/drive-duplicate-review-packets/asset_b5083d47177f475c/open-files-duplicate-review-packets-20260609T052202-0300.tar.gz
archive sha256: 0ac6db1f70b7d18d4be9036af15552e4f3db3b1b3238353495b461c3b563aa0e
```

## Packet Shape

| Measure | Count |
| --- | ---: |
| Duplicate groups | 62 |
| Row-context entries | 131 |
| Unassigned rows | 2 |
| Workspace-only groups | 43 |
| Multi-owner groups | 19 |
| Shared-drive-only groups | 52 |
| My Drive-only groups | 6 |
| Groups spanning My Drive and shared drive | 4 |
| Groups with ACL status `needs_review` | 62 |
| Groups with permission risk `unknown` | 62 |

Review reasons:

| Reason | Groups |
| --- | ---: |
| `acl_needs_review` | 62 |
| `permission_risk_unknown` | 62 |
| `multiple_owner_candidates` | 19 |
| `multiple_drive_roots` | 4 |
| `contains_unassigned_rows` | 2 |

## Owner Shape

Counts below are row-context entries, not unique canonical files, because owner
packets include full duplicate group context.

| Owner candidate | Row-context entries |
| --- | ---: |
| `workspace` | 112 |
| `finance` | 13 |
| `people` | 4 |
| `_unassigned` | 2 |

Owner-set breakdown:

| Owner set | Groups |
| --- | ---: |
| `workspace` only | 43 |
| `finance`, `workspace` | 13 |
| `people`, `workspace` | 4 |
| `_unassigned`, `workspace` | 2 |

Candidate survivor owner from the deterministic packet score:

| Candidate owner | Groups |
| --- | ---: |
| `workspace` | 45 |
| `finance` | 13 |
| `people` | 4 |

Candidate survivor root:

| Candidate root | Groups |
| --- | ---: |
| `shared_drive` | 56 |
| `my_drive` | 6 |

The deterministic candidate is only a review aid. It is not an approved
canonical survivor and does not prove that same-content rows are discardable
duplicates.

## File Shape

| Measure | Count |
| --- | ---: |
| Total row-context bytes | 75,117,415 |
| Zero-size rows | 0 |
| Two-row groups | 55 |
| Three-row groups | 7 |
| Largest group size | 3 |

Detailed MIME breakdown:

| MIME type | Rows |
| --- | ---: |
| `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | 76 |
| `application/pdf` | 28 |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | 19 |
| `application/msword` | 8 |

## High-Risk Groups

The workspace packet is smaller than the other owner packets, but it still has
19 multi-owner groups and 2 groups containing unassigned rows. The unassigned
groups are `dup_6b9afedfbbd70308` and `dup_c9031cd30f9a19c8`; both span My
Drive and shared drive and should be coordinated with unassigned duplicate task
`62a7ecf3`.

The finance/workspace lane has 13 groups and the people/workspace lane has 4
groups. These may represent shared operations or people records and should not
be auto-collapsed based only on content hash.

## Review Lane

This queue has two separate decisions:

1. Confirm owner placement for workspace-owned rows, cross-owner groups, and
   unassigned rows.
2. After owner confirmation, decide whether each duplicate group has a canonical
   logical survivor, true duplicate rows, or multiple intentional logical files.

Do not collapse those decisions. Same-content files may still represent
different business records if they live in different owner contexts, folders, or
Drive roots.

Reviewer guidance:

1. Start with the 2 unassigned groups, then finance/workspace and
   people/workspace groups.
2. Coordinate unassigned rows with `62a7ecf3`.
3. Treat finance and people candidates as review starting points only.
4. Route ACL approval through the Workspace and relevant cross-owner ACL gates
   after owner/survivor decisions; every row-context entry is still
   `acl_review_status = needs_review` and `permission_risk = unknown`.
5. Use duplicate approval gate `drive-duplicate-survivor-approval` on task
   `9025f930` before marking canonical survivors, true duplicates, owner
   assignments, or duplicate exceptions.

Recommended command pattern:

```bash
bun src/cli/index.tsx organize duplicates --owner workspace --include-rows --limit 10000 --json
```

Do not run `organize review` for this queue until the duplicate survivor and
owner approval gates are recorded.
