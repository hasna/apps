# Open Files Finance Duplicate Review Prep - 2026-06-09

Scope: read-only preparation for task `8c29bd6b`, the duplicate groups that
contain finance-owned rows.

This document does not assign owners, set target paths, approve ACLs, mark
duplicates, mark files moved, rewrite S3 keys, or change canonical Postgres.

Source packet:

```txt
local: /home/hasna/.hasna/files/open-files-duplicate-review-packets-20260609T052202+0300/finance.json
packet sha256: 2118e187b05b817721367949a004f1e89e555dc93505e4a447a2642e688c9014
s3 asset: asset_b5083d47177f475c
s3 archive: s3://hasna-xyz-opensource-files-prod/orgs/hasna-xyz/companies/_global/open-files/2026/06/drive-duplicate-review-packets/asset_b5083d47177f475c/open-files-duplicate-review-packets-20260609T052202-0300.tar.gz
archive sha256: 0ac6db1f70b7d18d4be9036af15552e4f3db3b1b3238353495b461c3b563aa0e
```

## Packet Shape

| Measure | Count |
| --- | ---: |
| Duplicate groups | 404 |
| Row-context entries | 966 |
| Unassigned rows | 10 |
| Finance-only groups | 176 |
| Multi-owner groups | 228 |
| Shared-drive-only groups | 330 |
| My Drive-only groups | 58 |
| Groups spanning My Drive and shared drive | 16 |
| Groups with ACL status `needs_review` | 404 |
| Groups with permission risk `unknown` | 404 |

Review reasons:

| Reason | Groups |
| --- | ---: |
| `acl_needs_review` | 404 |
| `permission_risk_unknown` | 404 |
| `multiple_owner_candidates` | 228 |
| `multiple_drive_roots` | 16 |
| `contains_unassigned_rows` | 10 |

## Owner Shape

Counts below are row-context entries, not unique canonical files, because owner
packets include full duplicate group context.

| Owner candidate | Row-context entries |
| --- | ---: |
| `finance` | 658 |
| `legal` | 259 |
| `product` | 17 |
| `workspace` | 13 |
| `_unassigned` | 10 |
| `people` | 9 |

Owner-set breakdown:

| Owner set | Groups |
| --- | ---: |
| `finance`, `legal` | 186 |
| `finance` only | 176 |
| `finance`, `workspace` | 13 |
| `finance`, `product` | 11 |
| `_unassigned`, `finance` | 10 |
| `finance`, `people` | 8 |

Candidate survivor owner from the deterministic packet score:

| Candidate owner | Groups |
| --- | ---: |
| `finance` | 404 |

Candidate survivor root:

| Candidate root | Groups |
| --- | ---: |
| `shared_drive` | 346 |
| `my_drive` | 58 |

The deterministic candidate is only a review aid. It is not an approved
canonical survivor and does not prove that same-content rows are discardable
duplicates.

## File Shape

| Measure | Count |
| --- | ---: |
| Total row-context bytes | 493,921,174 |
| Zero-size rows | 0 |
| Two-row groups | 314 |
| Three-row groups | 58 |
| Four-row groups | 25 |
| Groups with five or more rows | 7 |
| Largest group size | 30 |

Detailed MIME breakdown:

| MIME type | Rows |
| --- | ---: |
| `application/pdf` | 821 |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | 51 |
| `text/csv` | 40 |
| `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | 26 |
| `image/png` | 10 |
| `application/zip` | 6 |
| `image/jpeg` | 5 |
| `application/msword` | 4 |
| `application/x-zip-compressed` | 3 |

## High-Risk Groups

The largest finance-only group is `dup_975a63deb557058a` with 30 shared-drive
rows. Even though it is finance-only, it still needs owner, ACL, and permission
risk review before duplicate status is applied.

The finance/legal overlap is the dominant cross-owner risk: 186 groups. Several
large groups, including `dup_97daef1f48c0c584`, have finance and legal rows in
the same shared-drive duplicate group. These may represent separate finance and
legal records rather than redundant copies.

The 10 `_unassigned`/finance groups should be coordinated with unassigned
duplicate task `62a7ecf3` before survivor or exception decisions.

## Review Lane

This queue has two separate decisions:

1. Confirm owner placement for finance-owned rows and cross-owner groups.
2. After owner confirmation, decide whether each duplicate group has a canonical
   logical survivor, true duplicate rows, or multiple intentional logical files.

Do not collapse those decisions. Same-content files may still represent
different business records if they live in different owner contexts, folders, or
Drive roots.

Reviewer guidance:

1. Start with the 186 finance/legal groups, then the 10 groups containing
   unassigned rows.
2. Treat the deterministic finance candidate as a starting point only.
3. Coordinate unassigned rows with `62a7ecf3`.
4. Route ACL approval through the Finance and relevant cross-owner ACL gates
   after owner/survivor decisions; every row-context entry is still
   `acl_review_status = needs_review` and `permission_risk = unknown`.
5. Use duplicate approval gate `drive-duplicate-survivor-approval` on task
   `8c29bd6b` before marking canonical survivors, true duplicates, owner
   assignments, or duplicate exceptions.

Recommended command pattern:

```bash
bun src/cli/index.tsx organize duplicates --owner finance --include-rows --limit 10000 --json
```

Do not run `organize review` for this queue until the duplicate survivor and
owner approval gates are recorded.
