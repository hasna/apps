# Open Files My Drive Small/Loose Review Prep - 2026-06-09

Scope: read-only preparation for task `8fabb7b2`, the remaining small My Drive
folders and loose root files queue.

This document does not assign owners, set target paths, approve ACLs, mark
duplicates, mark files moved, rewrite S3 keys, or change canonical Postgres.

Source packet:

```txt
local: /home/hasna/.hasna/files/open-files-unassigned-review-packets-20260609T052604+0300/remaining-small-loose.json
s3 asset: asset_e3906bfbb4c447fb
s3 archive: s3://hasna-xyz-opensource-files-prod/orgs/hasna-xyz/companies/_global/open-files/2026/06/drive-unassigned-review-packets/asset_e3906bfbb4c447fb/open-files-unassigned-review-packets-20260609T052604-0300.tar.gz
archive sha256: e7977ac67e9a6b8a26347aa4d16cb0993c6572a28ac60c6195926ba9dbf80f6a
```

## Packet Shape

| Measure | Count |
| --- | ---: |
| Groups | 112 |
| Rows | 119 |
| Duplicate-overlap rows | 14 |
| Loose-root review groups | 101 |
| Small-folder review groups | 11 |

## Conservative Review Lanes

These lanes are only keyword-based reviewer aids. They are not approved owner
assignments. Any ambiguous item remains in `owner-review-required`.

| Proposed review lane | Groups | Rows | Duplicate-overlap rows | Loose-root groups | Small-folder groups |
| --- | ---: | ---: | ---: | ---: | ---: |
| finance | 21 | 21 | 6 | 21 | 0 |
| people | 2 | 2 | 1 | 2 | 0 |
| legal | 3 | 3 | 0 | 2 | 1 |
| marketing-sales | 31 | 31 | 2 | 27 | 4 |
| product-research | 7 | 7 | 1 | 6 | 1 |
| owner-review-required | 48 | 55 | 4 | 43 | 5 |

Reviewer guidance:

1. Start with the 55 `owner-review-required` rows. These are intentionally not
   force-classified.
2. Review the 14 duplicate-overlap rows together with duplicate gate
   `c1b639c8` before marking canonical survivors or exceptions.
3. Use owner approval gate `drive-owner-assignment-approval` on task
   `8fabb7b2` before applying owner or target-path metadata.
4. After owner assignment, route these rows into the post-unassigned My Drive
   ACL gate `424ecee9`.

Recommended command pattern:

```bash
bun src/cli/index.tsx organize unassigned --root-type my_drive --include-rows --json
bun src/cli/index.tsx organize unassigned --root-type my_drive --exclude-top-level "USB and External Devices" --exclude-top-level "Hasna (3)" --exclude-top-level "Archive" --exclude-top-level "Signed Affidavit and Testimonials" --exclude-top-level "Pentru Diana & Andrei" --exclude-top-level "Hasna" --include-rows --json
```

Do not run `organize review` for this queue until the owner approval gate is
recorded.
