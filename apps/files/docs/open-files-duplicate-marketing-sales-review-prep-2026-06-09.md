# Open Files Marketing-Sales Duplicate Review Prep - 2026-06-09

Scope: read-only preparation for task `6cb4bd04`, the duplicate groups that
contain marketing-sales-owned rows.

This document does not assign owners, set target paths, approve ACLs, mark
duplicates, mark files moved, rewrite S3 keys, or change canonical Postgres.

Source packet:

```txt
local: /home/hasna/.hasna/files/open-files-duplicate-review-packets-20260609T052202+0300/marketing-sales.json
packet sha256: f4e6e665cfe5e298204bc2687900d218ff7a066fbfd8fee03ab00f78a7f032ba
s3 asset: asset_b5083d47177f475c
s3 archive: s3://hasna-xyz-opensource-files-prod/orgs/hasna-xyz/companies/_global/open-files/2026/06/drive-duplicate-review-packets/asset_b5083d47177f475c/open-files-duplicate-review-packets-20260609T052202-0300.tar.gz
archive sha256: 0ac6db1f70b7d18d4be9036af15552e4f3db3b1b3238353495b461c3b563aa0e
```

## Packet Shape

| Measure | Count |
| --- | ---: |
| Duplicate groups | 283 |
| Row-context entries | 602 |
| Unassigned rows | 167 |
| Marketing-sales-only groups | 16 |
| Multi-owner groups | 267 |
| My Drive-only groups | 101 |
| Groups spanning My Drive and shared drive | 182 |
| Groups with ACL status `needs_review` | 283 |
| Groups with permission risk `unknown` | 283 |

Review reasons:

| Reason | Groups |
| --- | ---: |
| `acl_needs_review` | 283 |
| `permission_risk_unknown` | 283 |
| `multiple_owner_candidates` | 267 |
| `multiple_drive_roots` | 182 |
| `contains_unassigned_rows` | 166 |

## Owner Shape

Counts below are row-context entries, not unique canonical files, because owner
packets include full duplicate group context.

| Owner candidate | Row-context entries |
| --- | ---: |
| `marketing-sales` | 311 |
| `_unassigned` | 167 |
| `product` | 124 |

Owner-set breakdown:

| Owner set | Groups |
| --- | ---: |
| `_unassigned`, `marketing-sales` | 166 |
| `marketing-sales`, `product` | 101 |
| `marketing-sales` only | 16 |

Candidate survivor owner from the deterministic packet score:

| Candidate owner | Groups |
| --- | ---: |
| `marketing-sales` | 182 |
| `product` | 101 |

Candidate survivor root:

| Candidate root | Groups |
| --- | ---: |
| `shared_drive` | 182 |
| `my_drive` | 101 |

The deterministic candidate is only a review aid. It is not an approved
canonical survivor and does not prove that same-content rows are discardable
duplicates.

## File Shape

| Measure | Count |
| --- | ---: |
| Total row-context bytes | 994,318,904 |
| Zero-size rows | 0 |
| Two-row groups | 248 |
| Three-row groups | 34 |
| Four-row groups | 1 |
| Largest group size | 4 |

Detailed MIME breakdown:

| MIME type | Rows |
| --- | ---: |
| `image/jpeg` | 359 |
| `image/png` | 68 |
| `application/x-font-ttf` | 58 |
| `application/postscript` | 52 |
| `image/svg+xml` | 24 |
| `application/x-font-otf` | 20 |
| `application/pdf` | 8 |
| `text/plain` | 5 |
| `application/x-xfig` | 4 |
| `application/font-woff` | 2 |
| `application/octet-stream` | 2 |

## High-Risk Groups

The marketing-sales packet is dominated by owner ambiguity: 267 of 283 groups
are multi-owner, and 166 groups contain unassigned rows. Coordinate those rows
with unassigned duplicate task `62a7ecf3` before survivor or exception
decisions.

The marketing-sales/product lane has 101 groups and may contain shared campaign,
brand, product, or design assets. Same-content rows may intentionally live in
both product and marketing contexts.

The largest group is `dup_b094275159d4b0ca` with 4 rows across
marketing-sales/product and My Drive/shared-drive roots. It should be reviewed
as a cross-owner, cross-root group.

## Review Lane

This queue has two separate decisions:

1. Confirm owner placement for marketing-sales-owned rows, product overlaps, and
   unassigned rows.
2. After owner confirmation, decide whether each duplicate group has a canonical
   logical survivor, true duplicate rows, or multiple intentional logical files.

Do not collapse those decisions. Same-content files may still represent
different business records if they live in different owner contexts, folders, or
Drive roots.

Reviewer guidance:

1. Start with the 166 groups containing unassigned rows, then the 101
   marketing-sales/product groups.
2. Coordinate unassigned rows with `62a7ecf3`.
3. Treat product candidates as review starting points only.
4. Route ACL approval through the Marketing/Sales, Product, and post-unassigned
   ACL gates after owner/survivor decisions; every row-context entry is still
   `acl_review_status = needs_review` and `permission_risk = unknown`.
5. Use duplicate approval gate `drive-duplicate-survivor-approval` on task
   `6cb4bd04` before marking canonical survivors, true duplicates, owner
   assignments, or duplicate exceptions.

Recommended command pattern:

```bash
bun src/cli/index.tsx organize duplicates --owner marketing-sales --include-rows --limit 10000 --json
```

Do not run `organize review` for this queue until the duplicate survivor and
owner approval gates are recorded.
