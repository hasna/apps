# Open Files Product Duplicate Review Prep - 2026-06-09

Scope: read-only preparation for task `6956c109`, the duplicate groups that
contain product-owned rows.

This document does not assign owners, set target paths, approve ACLs, mark
duplicates, mark files moved, rewrite S3 keys, or change canonical Postgres.

Source packet:

```txt
local: /home/hasna/.hasna/files/open-files-duplicate-review-packets-20260609T052202+0300/product.json
packet sha256: 5fd306a21aced50e42601fe1f82ff8ac7cfc6166259406ebab109795633dd070
s3 asset: asset_b5083d47177f475c
s3 archive: s3://hasna-xyz-opensource-files-prod/orgs/hasna-xyz/companies/_global/open-files/2026/06/drive-duplicate-review-packets/asset_b5083d47177f475c/open-files-duplicate-review-packets-20260609T052202-0300.tar.gz
archive sha256: 0ac6db1f70b7d18d4be9036af15552e4f3db3b1b3238353495b461c3b563aa0e
```

## Packet Shape

| Measure | Count |
| --- | ---: |
| Duplicate groups | 925 |
| Row-context entries | 2,391 |
| Unassigned rows | 3 |
| Product-only groups | 812 |
| Multi-owner groups | 113 |
| Shared-drive-only groups | 823 |
| Groups spanning My Drive and shared drive | 102 |
| Groups with ACL status `needs_review` | 925 |
| Groups with permission risk `unknown` | 925 |

Review reasons:

| Reason | Groups |
| --- | ---: |
| `acl_needs_review` | 925 |
| `permission_risk_unknown` | 925 |
| `multiple_owner_candidates` | 113 |
| `multiple_drive_roots` | 102 |
| `contains_unassigned_rows` | 1 |

## Owner Shape

Counts below are row-context entries, not unique canonical files, because owner
packets include full duplicate group context.

| Owner candidate | Row-context entries |
| --- | ---: |
| `product` | 2,276 |
| `marketing-sales` | 101 |
| `finance` | 11 |
| `_unassigned` | 3 |

Owner-set breakdown:

| Owner set | Groups |
| --- | ---: |
| `product` only | 812 |
| `marketing-sales`, `product` | 101 |
| `finance`, `product` | 11 |
| `_unassigned`, `product` | 1 |

Candidate survivor owner from the deterministic packet score:

| Candidate owner | Groups |
| --- | ---: |
| `product` | 914 |
| `finance` | 11 |

All 925 deterministic candidate rows are shared-drive rows and currently
`in_review`. The deterministic candidate is only a review aid. It is not an
approved canonical survivor and does not prove that same-content rows are
discardable duplicates.

## File Shape

| Measure | Count |
| --- | ---: |
| Total row-context bytes | 5,875,469,043 |
| Zero-size rows | 31 |
| Groups containing zero-size rows | 1 |
| Two-row groups | 553 |
| Three-row groups | 279 |
| Four-row groups | 81 |
| Groups with five or more rows | 12 |
| Largest group size | 35 |

Detailed MIME breakdown:

| MIME type | Rows |
| --- | ---: |
| `image/svg+xml` | 1,037 |
| `image/jpeg` | 742 |
| `image/png` | 282 |
| `application/pdf` | 137 |
| `application/postscript` | 82 |
| `application/x-font-otf` | 38 |
| `image/x-photoshop` | 28 |
| `video/mp4` | 17 |
| `application/octet-stream` | 6 |
| `application/zip` | 4 |
| `image/x-sony-arw` | 4 |
| `video/quicktime` | 4 |
| `application/msword` | 2 |
| `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | 2 |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | 2 |
| `application/x-zip-compressed` | 2 |
| `audio/mpeg` | 2 |

## High-Risk Groups

The largest product-only group has 35 rows and remains subject to owner review,
ACL review, and permission-risk review. It should not be auto-collapsed simply
because all rows are product-owned.

The zero-size overlap group `dup_e3b0c44298fc1c14` appears in this product
packet and in the unassigned duplicate packet. It has 31 rows, 3 unassigned My
Drive rows, and both My Drive and shared-drive context. Validate source/export
evidence before marking any row in that group as a duplicate or canonical
survivor.

The 101 marketing-sales/product groups and 11 finance/product groups need
cross-owner review. Same-content rows may represent intentionally shared assets,
finance/legal records, marketing collateral, or product artifacts.

## Review Lane

This queue has two separate decisions:

1. Confirm owner placement for product-owned rows and cross-owner groups.
2. After owner confirmation, decide whether each duplicate group has a canonical
   logical survivor, true duplicate rows, or multiple intentional logical files.

Do not collapse those decisions. Same-content files may still represent
different business records if they live in different owner contexts, folders, or
Drive roots.

Reviewer guidance:

1. Start with the 113 multi-owner groups, especially the 101
   marketing-sales/product groups and 11 finance/product groups.
2. Coordinate `dup_e3b0c44298fc1c14` with unassigned duplicate task `62a7ecf3`
   and source/export validation before applying any decision.
3. Treat the deterministic candidate survivor as a suggested review starting
   point only. Product ownership and shared-drive placement do not by themselves
   prove duplicate status.
4. Route ACL approval through the shared-drive Product ACL gate after survivor
   and owner decisions; every row-context entry is still `acl_review_status =
   needs_review` and `permission_risk = unknown`.
5. Use duplicate approval gate `drive-duplicate-survivor-approval` on task
   `6956c109` before marking canonical survivors, true duplicates, owner
   assignments, or duplicate exceptions.

Recommended command pattern:

```bash
bun src/cli/index.tsx organize duplicates --owner product --include-rows --limit 10000 --json
```

Do not run `organize review` for this queue until the duplicate survivor and
owner approval gates are recorded.
