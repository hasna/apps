# Open Files Legal Duplicate Review Prep - 2026-06-09

Scope: read-only preparation for task `704f037f`, the duplicate groups that
contain legal-owned rows.

This document does not assign owners, set target paths, approve ACLs, mark
duplicates, mark files moved, rewrite S3 keys, or change canonical Postgres.

Source packet:

```txt
local: /home/hasna/.hasna/files/open-files-duplicate-review-packets-20260609T052202+0300/legal.json
packet sha256: f0cbe1e90ffe3c3055875ff48f854df7a8b8bc8c84e9faa3508f88aa46d93af3
s3 asset: asset_b5083d47177f475c
s3 archive: s3://hasna-xyz-opensource-files-prod/orgs/hasna-xyz/companies/_global/open-files/2026/06/drive-duplicate-review-packets/asset_b5083d47177f475c/open-files-duplicate-review-packets-20260609T052202-0300.tar.gz
archive sha256: 0ac6db1f70b7d18d4be9036af15552e4f3db3b1b3238353495b461c3b563aa0e
```

## Packet Shape

| Measure | Count |
| --- | ---: |
| Duplicate groups | 288 |
| Row-context entries | 708 |
| Unassigned rows | 0 |
| Legal-only groups | 42 |
| Multi-owner groups | 246 |
| Shared-drive-only groups | 287 |
| Groups spanning My Drive and shared drive | 1 |
| Groups with ACL status `needs_review` | 288 |
| Groups with permission risk `unknown` | 288 |

Review reasons:

| Reason | Groups |
| --- | ---: |
| `acl_needs_review` | 288 |
| `permission_risk_unknown` | 288 |
| `multiple_owner_candidates` | 246 |
| `multiple_drive_roots` | 1 |

## Owner Shape

Counts below are row-context entries, not unique canonical files, because owner
packets include full duplicate group context.

| Owner candidate | Row-context entries |
| --- | ---: |
| `legal` | 418 |
| `finance` | 230 |
| `people` | 60 |

Owner-set breakdown:

| Owner set | Groups |
| --- | ---: |
| `finance`, `legal` | 186 |
| `legal`, `people` | 60 |
| `legal` only | 42 |

Candidate survivor owner from the deterministic packet score:

| Candidate owner | Groups |
| --- | ---: |
| `finance` | 186 |
| `legal` | 102 |

All 288 deterministic candidate rows are shared-drive rows and currently
`in_review`. The deterministic candidate is only a review aid. It is not an
approved canonical survivor and does not prove that same-content rows are
discardable duplicates.

## File Shape

| Measure | Count |
| --- | ---: |
| Total row-context bytes | 524,050,675 |
| Zero-size rows | 0 |
| Two-row groups | 198 |
| Three-row groups | 60 |
| Four-row groups | 23 |
| Groups with five or more rows | 7 |
| Largest group size | 9 |

Detailed MIME breakdown:

| MIME type | Rows |
| --- | ---: |
| `application/pdf` | 562 |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | 75 |
| `image/jpeg` | 50 |
| `application/zip` | 8 |
| `image/png` | 8 |
| `application/x-zip-compressed` | 3 |
| `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | 2 |

## High-Risk Groups

The legal packet is mostly cross-owner: 246 of 288 groups. The finance/legal
lane is the largest overlap with 186 groups and deterministic candidate owner
`finance` for all 186. Those candidates need legal/finance review before
survivor or duplicate marking.

The legal/people lane has 60 groups and may include HR, people-ops, or legal
records. Do not auto-collapse these without owner confirmation.

## Review Lane

This queue has two separate decisions:

1. Confirm owner placement for legal-owned rows and cross-owner groups.
2. After owner confirmation, decide whether each duplicate group has a canonical
   logical survivor, true duplicate rows, or multiple intentional logical files.

Do not collapse those decisions. Same-content files may still represent
different business records if they live in different owner contexts, folders, or
Drive roots.

Reviewer guidance:

1. Start with the 186 finance/legal groups, then the 60 legal/people groups.
2. Treat deterministic finance candidates as review starting points only.
3. Apply privilege, contract, and employee-record sensitivity during owner
   review; do not rely on MIME type alone.
4. Route ACL approval through the Legal and relevant cross-owner ACL gates after
   owner/survivor decisions; every row-context entry is still
   `acl_review_status = needs_review` and `permission_risk = unknown`.
5. Use duplicate approval gate `drive-duplicate-survivor-approval` on task
   `704f037f` before marking canonical survivors, true duplicates, owner
   assignments, or duplicate exceptions.

Recommended command pattern:

```bash
bun src/cli/index.tsx organize duplicates --owner legal --include-rows --limit 10000 --json
```

Do not run `organize review` for this queue until the duplicate survivor and
owner approval gates are recorded.
