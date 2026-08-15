# Open Files Migration Current State

Last recorded local execution: 2026-06-15.

Unified Drive policy:

- My Drive and Shared Drives are treated as one Google Drive import corpus.
- Root type remains audit metadata only.
- Final placement is by owner and normalized virtual target path.
- S3 objects remain immutable under canonical content-addressed keys.
- Legacy/import buckets remain backup sources until final retirement gates close.

Owner lanes after policy:

```text
product: 6,242
finance: 3,705
people: 2,952
marketing-sales: 2,335
archive: 1,320
legal: 746
workspace: 582
personal-review: 211
intake: 119
```

Audit artifact:

```text
/tmp/open-files-unified-drive-policy-audit-2026-06-15.json
sha256: 14862a28372f71f7dae8d65ce3ff41e06030f95fae678d08eeca3a14180980fb
```

Next work:

- Build extractor coverage for every MIME lane.
- Content-review and semantically rename `intake`, `personal-review`, `archive`, and high-sensitivity legal/finance/people rows.
- Push verified metadata to canonical Postgres/RDS once the production DB path is approved.
- Keep legacy buckets readable until final audit and retirement approval.
