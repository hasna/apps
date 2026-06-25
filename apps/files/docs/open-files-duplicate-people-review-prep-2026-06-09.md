# Open Files People Duplicate Review Prep - 2026-06-09

Scope: read-only preparation for task `f285ba84`, the duplicate groups that
contain people-owned rows.

This document does not assign owners, set target paths, approve ACLs, mark
duplicates, mark files moved, rewrite S3 keys, or change canonical Postgres.

Source packet:

```txt
local: /home/hasna/.hasna/files/open-files-duplicate-review-packets-20260609T052202+0300/people.json
packet sha256: ea8ddd608997dc4c3b8a10da68f5dabdcc7bf20806e170bccfceb0bebaabb893
s3 asset: asset_b5083d47177f475c
s3 archive: s3://hasna-xyz-opensource-files-prod/orgs/hasna-xyz/companies/_global/open-files/2026/06/drive-duplicate-review-packets/asset_b5083d47177f475c/open-files-duplicate-review-packets-20260609T052202-0300.tar.gz
archive sha256: 0ac6db1f70b7d18d4be9036af15552e4f3db3b1b3238353495b461c3b563aa0e
```

## Packet Shape

| Measure | Count |
| --- | ---: |
| Duplicate groups | 238 |
| Row-context entries | 496 |
| Unassigned rows | 0 |
| People-only groups | 166 |
| Multi-owner groups | 72 |
| Shared-drive-only groups | 95 |
| My Drive-only groups | 22 |
| Groups spanning My Drive and shared drive | 121 |
| Groups with ACL status `needs_review` | 238 |
| Groups with permission risk `unknown` | 238 |

Review reasons:

| Reason | Groups |
| --- | ---: |
| `acl_needs_review` | 238 |
| `permission_risk_unknown` | 238 |
| `multiple_drive_roots` | 121 |
| `multiple_owner_candidates` | 72 |

## Owner Shape

Counts below are row-context entries, not unique canonical files, because owner
packets include full duplicate group context.

| Owner candidate | Row-context entries |
| --- | ---: |
| `people` | 423 |
| `legal` | 60 |
| `finance` | 8 |
| `workspace` | 5 |

Owner-set breakdown:

| Owner set | Groups |
| --- | ---: |
| `people` only | 166 |
| `legal`, `people` | 60 |
| `finance`, `people` | 8 |
| `people`, `workspace` | 4 |

Candidate survivor owner from the deterministic packet score:

| Candidate owner | Groups |
| --- | ---: |
| `people` | 170 |
| `legal` | 60 |
| `finance` | 8 |

Candidate survivor root:

| Candidate root | Groups |
| --- | ---: |
| `shared_drive` | 216 |
| `my_drive` | 22 |

The deterministic candidate is only a review aid. It is not an approved
canonical survivor and does not prove that same-content rows are discardable
duplicates.

## File Shape

| Measure | Count |
| --- | ---: |
| Total row-context bytes | 519,164,279 |
| Zero-size rows | 0 |
| Two-row groups | 218 |
| Three-row groups | 20 |
| Largest group size | 3 |

Detailed MIME breakdown:

| MIME type | Rows |
| --- | ---: |
| `application/pdf` | 273 |
| `image/jpeg` | 126 |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | 75 |
| `application/msword` | 11 |
| `image/png` | 7 |
| `application/vnd.openxmlformats-officedocument.presentationml.presentation` | 2 |
| `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | 2 |

## High-Risk Groups

The people packet has no unassigned rows and no zero-size rows. The main risk is
semantic, not technical: 121 groups span My Drive and shared drives, and 72
groups cross owner boundaries.

The legal/people overlap is the largest cross-owner lane with 60 groups. These
may represent HR, legal, people-ops, or employee records and should not be
auto-collapsed based only on content hash.

## Review Lane

This queue has two separate decisions:

1. Confirm owner placement for people-owned rows and cross-owner groups.
2. After owner confirmation, decide whether each duplicate group has a canonical
   logical survivor, true duplicate rows, or multiple intentional logical files.

Do not collapse those decisions. Same-content files may still represent
different business records if they live in different owner contexts, folders, or
Drive roots.

Reviewer guidance:

1. Start with the 60 legal/people groups, then the finance/people and
   people/workspace groups.
2. Review cross-root groups carefully; My Drive copies may be personal exports,
   working copies, or intentionally retained records.
3. Treat the deterministic candidate survivor as a suggested review starting
   point only.
4. Route ACL approval through the People and relevant cross-owner ACL gates
   after owner/survivor decisions; every row-context entry is still
   `acl_review_status = needs_review` and `permission_risk = unknown`.
5. Use duplicate approval gate `drive-duplicate-survivor-approval` on task
   `f285ba84` before marking canonical survivors, true duplicates, owner
   assignments, or duplicate exceptions.

Recommended command pattern:

```bash
bun src/cli/index.tsx organize duplicates --owner people --include-rows --limit 10000 --json
```

Do not run `organize review` for this queue until the duplicate survivor and
owner approval gates are recorded.
