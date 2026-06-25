# Open Files Unassigned Duplicate Review Prep - 2026-06-09

Scope: read-only preparation for task `62a7ecf3`, the duplicate groups that
contain unassigned rows.

This document does not assign owners, set target paths, approve ACLs, mark
duplicates, mark files moved, rewrite S3 keys, or change canonical Postgres.

Source packet:

```txt
local: /home/hasna/.hasna/files/open-files-duplicate-review-packets-20260609T052202+0300/unassigned.json
packet sha256: 5584e8528884076e3521186992c338432a8f9c45e6c44867d44a88caf089c786
s3 asset: asset_b5083d47177f475c
s3 archive: s3://hasna-xyz-opensource-files-prod/orgs/hasna-xyz/companies/_global/open-files/2026/06/drive-duplicate-review-packets/asset_b5083d47177f475c/open-files-duplicate-review-packets-20260609T052202-0300.tar.gz
archive sha256: 0ac6db1f70b7d18d4be9036af15552e4f3db3b1b3238353495b461c3b563aa0e
```

## Packet Shape

| Measure | Count |
| --- | ---: |
| Duplicate groups | 180 |
| Row-context entries | 404 |
| Unassigned rows | 184 |
| Groups needing owner review | 180 |
| Groups with multiple owner candidates | 179 |
| Groups spanning My Drive and shared drive | 92 |
| Groups with only My Drive rows | 88 |
| Groups with ACL status `needs_review` | 180 |
| Groups with permission risk `unknown` | 180 |

Review reasons:

| Reason | Groups |
| --- | ---: |
| `contains_unassigned_rows` | 180 |
| `acl_needs_review` | 180 |
| `permission_risk_unknown` | 180 |
| `multiple_owner_candidates` | 179 |
| `multiple_drive_roots` | 92 |

## 2026-06-11 Read-Only Re-Audit

Task `aa0d6816` recomputed the duplicate-unassigned lane from the local review
database without printing file names, paths, object keys, ACL payloads, or
changing review rows. The packet shape still matches this document: 180 groups,
404 row-context entries, 184 unassigned row contexts, 180 groups needing ACL
review, 180 groups with unknown permission risk, 179 multi-owner-candidate
groups, and one all-unassigned group.

The same audit verified local approval gate coverage before any state-changing
owner assignment or duplicate-survivor work: seven expected aggregate gates,
seven pending aggregate gates, zero missing aggregate gates, and 23 scoped
pending mutation/gate tasks with 23 pending approval checkpoints.

Evidence:

| Artifact | Lines | SHA-256 |
| --- | ---: | --- |
| `/tmp/open-files-duplicate-unassigned-aggregate-audit-2026-06-11.tsv` | 24 | `55bb35869b7659fc81111a691098236a8ddd5033a5aa693df1a2b2f505b3c97f` |

## Owner Shape

The 184 unassigned rows are all My Drive rows. Owner counts below are row-context
counts, not unique canonical files, because the packet includes full duplicate
group context for each unassigned group.

| Owner candidate | Row-context entries |
| --- | ---: |
| `_unassigned` | 184 |
| `marketing-sales` | 178 |
| `product` | 28 |
| `finance` | 10 |
| `workspace` | 4 |

Owner-set breakdown:

| Owner set | Groups |
| --- | ---: |
| `_unassigned`, `marketing-sales` | 166 |
| `_unassigned`, `finance` | 10 |
| `_unassigned`, `workspace` | 2 |
| `_unassigned`, `product` | 1 |
| `_unassigned` only | 1 |

Candidate survivor owner from the deterministic packet score:

| Candidate owner | Groups |
| --- | ---: |
| `marketing-sales` | 166 |
| `finance` | 10 |
| `workspace` | 2 |
| `product` | 1 |
| missing/unassigned-only | 1 |

The deterministic candidate is only a review aid. It is not an approved
canonical survivor and does not prove that the paired unassigned row is a
discardable duplicate.

## File Shape

| Measure | Count |
| --- | ---: |
| Total row-context bytes | 459,124,588 |
| Zero-size rows | 31 |
| Groups containing zero-size rows | 1 |
| Two-row groups | 164 |
| Three-row groups | 15 |
| Largest group size | 31 |

Detailed MIME breakdown:

| MIME type | Rows |
| --- | ---: |
| `image/jpeg` | 130 |
| `image/png` | 68 |
| `application/x-font-ttf` | 58 |
| `application/postscript` | 52 |
| `application/pdf` | 28 |
| `image/svg+xml` | 24 |
| `application/x-font-otf` | 20 |
| `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | 6 |
| `text/plain` | 5 |
| `video/mp4` | 5 |
| `application/x-xfig` | 4 |
| `application/font-woff` | 2 |
| `application/octet-stream` | 2 |

## High-Risk Groups

The largest group is `dup_e3b0c44298fc1c14`: 31 rows, 3 unassigned rows,
`product` as the packet candidate owner, both My Drive and shared-drive context,
and all 31 zero-size rows. Treat this as a source/export validation issue before
any duplicate decision. A zero-byte group can represent empty files,
placeholders, failed copies, or export artifacts.

One group is fully unassigned: `dup_68010c0c12c35319`, 2 My Drive rows, both
`Hasna Proposal.mp4`, both 32,183,782 bytes, no candidate owner in the packet.
This group needs owner assignment before survivor or duplicate marking.

## Review Lane

This queue has two separate decisions:

1. Assign an owner and target path, or approved exception, for each unassigned
   row.
2. After owner assignment, decide whether each duplicate group has a canonical
   logical survivor, true duplicate rows, or multiple intentional logical files.

Do not collapse those decisions. Same-content files may still represent
different business records if they live in different owner contexts, folders, or
Drive roots.

Reviewer guidance:

1. Start with the 184 unassigned My Drive rows. Most are paired with
   `marketing-sales`, but the packet also contains finance, workspace, product,
   and one all-unassigned group.
2. Validate `dup_e3b0c44298fc1c14` against source/export evidence before
   treating the zero-size rows as duplicates.
3. Assign owners for the all-unassigned `Hasna Proposal.mp4` pair before any
   survivor decision.
4. Route ACL approval through the relevant My Drive/shared-drive ACL gates after
   owner assignment; every row-context entry is still `acl_review_status =
   needs_review` and `permission_risk = unknown`.
5. Use duplicate approval gate `drive-duplicate-survivor-approval` on task
   `62a7ecf3` before marking canonical survivors, true duplicates, owner
   assignments, or duplicate exceptions.

Recommended command pattern:

```bash
bun src/cli/index.tsx organize duplicates --unassigned --include-rows --limit 10000 --json
```

Do not run `organize review` for this queue until the duplicate survivor and
owner approval gates are recorded.
