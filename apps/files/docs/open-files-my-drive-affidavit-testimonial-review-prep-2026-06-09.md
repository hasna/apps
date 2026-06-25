# Open Files My Drive Affidavit/Testimonial Review Prep - 2026-06-09

Scope: read-only preparation for task `12894a18`, the My Drive top-level folder
`Signed Affidavit and Testimonials`.

This document does not assign owners, set target paths, approve ACLs, mark
duplicates, mark files moved, rewrite S3 keys, or change canonical Postgres.

Source packet:

```txt
local: /home/hasna/.hasna/files/open-files-unassigned-review-packets-20260609T052604+0300/signed-affidavit-and-testimonials.json
s3 asset: asset_e3906bfbb4c447fb
s3 archive: s3://hasna-xyz-opensource-files-prod/orgs/hasna-xyz/companies/_global/open-files/2026/06/drive-unassigned-review-packets/asset_e3906bfbb4c447fb/open-files-unassigned-review-packets-20260609T052604-0300.tar.gz
archive sha256: e7977ac67e9a6b8a26347aa4d16cb0993c6572a28ac60c6195926ba9dbf80f6a
```

## Packet Shape

| Measure | Count |
| --- | ---: |
| Groups | 1 |
| Rows | 17 |
| Duplicate-overlap rows | 0 |
| Root files | 0 |
| Review track | folder-owner-review |

## File Shape

| Measure | Count |
| --- | ---: |
| PDF rows | 14 |
| DOCX rows | 3 |
| Zero-size rows | 0 |
| Total bytes | 14,085,984 |
| Min row bytes | 790,123 |
| Median row bytes | 795,760 |
| Max row bytes | 986,767 |

## Review Lane

All 17 rows should remain `owner-review-required` until an owner confirms
placement. The folder label suggests legal and/or marketing may need to review
the packet, but row names alone did not provide a safe enough signal to split
or assign the files automatically.

Reviewer guidance:

1. Confirm whether the folder belongs under legal records, marketing/social
   proof, a mixed collection, or an approved exception.
2. Do not infer ACL risk from the folder name. ACL review remains separate and
   should flow through the post-unassigned My Drive ACL gate `424ecee9` after
   owner assignment.
3. Use owner approval gate `drive-owner-assignment-approval` on task
   `12894a18` before applying owner or target-path metadata.

Recommended command pattern:

```bash
bun src/cli/index.tsx organize unassigned --root-type my_drive --top-level "Signed Affidavit and Testimonials" --include-rows --json
```

Do not run `organize review` for this queue until the owner approval gate is
recorded.
