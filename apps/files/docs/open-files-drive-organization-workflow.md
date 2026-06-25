# Open Files Drive Organization Workflow

Date: 2026-06-08

This workflow turns the migrated Google Drive archive into an operational
replacement for Google Drive. Canonical object keys stay immutable under
`objects/sha256/`; organization happens through review metadata, collections,
projects, labels, owners, and audit events.

## Current Queue State

The review queues were bootstrapped from `google_drive_imported_objects` after
canonical Postgres import and canonical object mapping.

```txt
Review rows: 18,212
Review status: 18,212 unreviewed
My Drive rows: 5,969
Shared Drive rows: 12,243
Duplicate-review rows: 4,382
Collections: 11
Review queue memberships: 22,594
Postgres push: complete
ACL review: pending for all imported rows until owners verify effective Drive permissions
```

Postgres verification after cleanup:

```txt
file_organization_reviews: 18,212
collection_files: 22,594
collections: 11
file_organization_events: 0
duplicate rows: 4,382
```

2026-06-09 audit export:

```txt
total: 18,212
unreviewed: 18,212
unassigned owner: 18,212
missing target: 18,212
ACL needs review: 18,212
permission risk unknown: 18,212
high-risk permissions: 0
duplicate rows: 4,382
My Drive rows: 5,969
Shared Drive rows: 12,243
```

Full audit export:

```txt
local: /home/hasna/.hasna/files/open-files-organization-audit-20260609T041409+0300.json
sha256: 241a56fe673a82f7d88791e27f9492a00c4b2102d18862e6f6064200e2b96efc
asset: asset_5e22f6de1d4a4b7b
s3: s3://hasna-xyz-opensource-files-prod/evidence/migration/orgs/hasna-xyz/companies/_global/open-files/2026/06/drive-organization-audit/asset_5e22f6de1d4a4b7b/open-files-organization-audit-20260609T041409-0300.json
size: 42,311,060 bytes
status: verified
```

2026-06-09 shared-drive candidate inference:

```txt
shared_drive rows scanned: 12,243
shared_drive rows staged: 12,243
review_status: 12,243 in_review; 5,969 unreviewed
unassigned owner: 5,969
missing target: 5,969
ACL needs review: 18,212
permission risk unknown: 18,212
event rows added: 12,243
Postgres push: file_organization_reviews 18,212/18,212; file_organization_events 12,243/12,243
```

Owner candidates staged from shared-drive top-level folders:

```txt
product: 6,242
finance: 3,299
people: 1,415
legal: 729
workspace: 463
marketing-sales: 95
```

This pass does not approve ACLs, mark rows moved, or change canonical S3 object
keys. It only records candidate owner/target metadata so owners can review by
business area.

Shared-drive inference audit export:

```txt
local: /home/hasna/.hasna/files/open-files-organization-audit-shared-drive-inferred-20260609T043018+0300.json
sha256: 09d15435c82909848c789def3e1d8fd99b4aa20a4bdc82b51d1e7763f260e41f
asset: asset_2b1e6ac8a93d4912
s3: s3://hasna-xyz-opensource-files-prod/orgs/hasna-xyz/companies/_global/open-files/2026/06/drive-organization-shared-drive-inference/asset_2b1e6ac8a93d4912/open-files-organization-audit-shared-drive-inferred-20260609T043018-0300.json
size: 53,648,281 bytes
status: verified
```

2026-06-09 My Drive candidate inference:

```txt
my_drive rows scanned: 5,969
my_drive rows staged: 4,302
my_drive rows left unreviewed/unassigned: 1,667
review_status: 16,545 in_review; 1,667 unreviewed
unassigned owner: 1,667
missing target: 1,667
ACL needs review: 18,212
permission risk unknown: 18,212
event rows total: 16,545
Postgres push: file_organization_reviews 18,212/18,212; file_organization_events 16,545/16,545
```

My Drive owner candidates were staged from high-confidence top-level folders
only:

```txt
marketing-sales: 2,240
people: 1,537
finance: 406
workspace: 119
```

This pass intentionally skipped ambiguous My Drive material such as external
device archives, personal/mixed folders, and loose root files. It does not
approve ACLs, mark rows moved, or change canonical S3 object keys.

My Drive inference audit export:

```txt
local: /home/hasna/.hasna/files/open-files-organization-audit-my-drive-inferred-20260609T044515+0300.json
sha256: f6467e97ffbb1a70303057e0c73a53d4f82af4bd331d8aa43eba553223ecc5b3
asset: asset_47f20a62f7724a58
s3: s3://hasna-xyz-opensource-files-prod/orgs/hasna-xyz/companies/_global/open-files/2026/06/drive-organization-my-drive-inference/asset_47f20a62f7724a58/open-files-organization-audit-my-drive-inferred-20260609T044515-0300.json
size: 57,246,611 bytes
status: verified
```

2026-06-09 remaining My Drive unassigned queue:

```txt
unassigned my_drive rows: 1,667
USB and External Devices: 1,300
Hasna (3): 180
Archive: 20
Signed Affidavit and Testimonials: 17
Pentru Diana & Andrei: 16
Hasna: 15
other small folders and loose root files: 119
```

These rows were intentionally left outside automatic inference because they are
ambiguous, personal/mixed, external-device archives, loose root files, or
otherwise need explicit owner review.

2026-06-09 My Drive unassigned review packet evidence archive:

```txt
asset: asset_e3906bfbb4c447fb
s3: s3://hasna-xyz-opensource-files-prod/orgs/hasna-xyz/companies/_global/open-files/2026/06/drive-unassigned-review-packets/asset_e3906bfbb4c447fb/open-files-unassigned-review-packets-20260609T052604-0300.tar.gz
sha256: e7977ac67e9a6b8a26347aa4d16cb0993c6572a28ac60c6195926ba9dbf80f6a
size: 116,772 bytes
status: verified
```

The archive contains seven read-only JSON packets plus a manifest and
checksums:

```txt
USB and External Devices: 1 group, 1,300 rows, 3 duplicate rows
Hasna (3): 1 group, 180 rows, 166 duplicate rows
Archive: 1 group, 20 rows, 1 duplicate row
Signed Affidavit and Testimonials: 1 group, 17 rows
Pentru Diana & Andrei: 1 group, 16 rows
Hasna: 1 group, 15 rows
remaining small folders and loose root files: 112 groups, 119 rows, 14 duplicate rows, 101 loose root files
```

2026-06-15 unified Drive policy execution:

The migration policy now treats My Drive and Shared Drives as one Google Drive
import corpus. Root type remains audit metadata only; final placement is by
business owner and normalized virtual target path. S3 objects remain immutable
under canonical content-addressed keys, and legacy/import buckets remain backup
sources until final retirement gates close.

Policy command:

```bash
files organize apply-drive-policy --apply
```

Policy behavior:

- assign one owner lane and normalized `target_path` to every Drive review row;
- normalize virtual folders/file names into lowercase dash-separated target
  paths;
- approve broad additive domain/team access for the migration baseline;
- choose each duplicate group's survivor by newest `modified_at`, then newest
  `indexed_at`;
- mark non-survivor duplicate rows as `duplicate`;
- do not rewrite canonical S3 object keys, copy/delete objects, or retire legacy
  buckets.

Post-apply local metadata counts:

```txt
total review rows: 18,212
approved survivor/non-duplicate rows: 15,648
duplicate non-survivor rows: 2,564
duplicate groups: 1,818
duplicate-review rows: 4,382
owners missing: 0
targets missing: 0
ACL needs review: 0
permission risk low: 18,212
high-risk permissions: 0
target collisions requiring suffixes: 0
```

Merged owner lanes after policy:

```txt
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

Post-apply dry-run returned `planned_updates: 0`, confirming the policy is
idempotent against the current local metadata snapshot.

Audit artifact:

```txt
local: /tmp/open-files-unified-drive-policy-audit-2026-06-15.json
sha256: 14862a28372f71f7dae8d65ce3ff41e06030f95fae678d08eeca3a14180980fb
size: 17,713,794 bytes
status: generated locally; contains private file metadata and must not be pasted into shared output
```

2026-06-09 ACL approval task split:

```txt
shared_drive approvals:
product: 6,242 rows -> e4cb7380
finance: 3,299 rows -> d417db6d
people: 1,415 rows -> 198f4cbe
legal: 729 rows -> 12163ddc
workspace: 463 rows -> 92b5f940
marketing-sales: 95 rows -> 187bb5fa

my_drive approvals:
marketing-sales: 2,240 rows -> c857dbc2
people: 1,537 rows -> b054dcf6
finance: 406 rows -> 2b00315b
workspace: 119 rows -> 95ab0a9f
newly assigned unresolved rows: 1,667 rows after 988a1e81 -> 424ecee9
```

The shared-drive ACL gate `10e93c88` depends on all six shared-drive owner
approval tasks. The My Drive ACL gate `8fe1f56c` depends on the four staged
owner approval tasks, the post-unassigned approval task, and remaining owner
resolution task `988a1e81`. These tasks collect approval evidence only; do not
change `acl_review_status`, lower `permission_risk`, mark rows moved, or rewrite
S3 keys without the owner/reviewer approval evidence requested by the task.
All eleven owner ACL tasks are marked `requires_approval=true` in todos, so
they cannot be completed as ordinary bookkeeping.

## Data Model

`file_organization_reviews` has one row per imported file record. It tracks:

- `file_id` and original source metadata.
- `profile`, `drive_id`, and `root_type` (`my_drive`, `shared_drive`, or
  `unknown`).
- Original/current path and target placement fields.
- Owner, labels, reviewer, status, notes, priority, duplicate group, and
  metadata containing canonical S3 details.
- ACL review state:
  `acl_review_status`, `permission_scope`, `permission_risk`,
  `permission_notes`, and `permissions_metadata`.

`file_organization_events` records review/audit changes:

- review id and file id,
- action, actor, status transition,
- before/after state,
- note and timestamp.

Collections are used as review queues:

```txt
Google Drive Archive Review
  andreihasnacom
    My Drive
      Unclassified
      Duplicates
    Shared Drives
      Unclassified
      Duplicates
```

Rows can also be assigned to destination collections/projects as review
decisions are made.

## Commands

Bootstrap or refresh queues:

```bash
files organize bootstrap-google-drive --json
```

Show progress:

```bash
files organize stats --json
```

The stats output includes `acl_needs_review`, `high_risk_permissions`,
`by_acl_status`, and `by_permission_risk`.

List unreviewed rows:

```bash
files organize list --status unreviewed --limit 50 --json
```

List duplicate rows:

```bash
files organize list --duplicates --limit 50 --json
```

Summarize duplicate content groups and deterministic survivor candidates:

```bash
files organize duplicates --limit 50 --json
files organize duplicates --owner finance --json
files organize duplicates --unassigned --include-rows --json
files organize duplicates --root-type my_drive --include-rows --json
```

The duplicate summary command does not mark rows as duplicates or delete any
logical file entries. It groups rows by `duplicate_group_id`, reports owner/root
conflicts, ACL/risk blockers, unassigned rows, and a deterministic
`candidate_survivor_review_id` so reviewers can work group-by-group without
rewriting content-addressed S3 objects.

2026-06-09 duplicate review packet evidence archive:

```txt
asset: asset_b5083d47177f475c
s3: s3://hasna-xyz-opensource-files-prod/orgs/hasna-xyz/companies/_global/open-files/2026/06/drive-duplicate-review-packets/asset_b5083d47177f475c/open-files-duplicate-review-packets-20260609T052202-0300.tar.gz
sha256: 0ac6db1f70b7d18d4be9036af15552e4f3db3b1b3238353495b461c3b563aa0e
size: 568,952 bytes
status: verified
```

The archive contains seven read-only JSON packets plus a manifest and
checksums. Owner packets include full duplicate-group row context, so
cross-owner groups intentionally appear in more than one packet:

```txt
product: 925 groups, 2,391 row-context entries, 3 unassigned rows
finance: 404 groups, 966 row-context entries, 10 unassigned rows
people: 238 groups, 496 row-context entries, 0 unassigned rows
legal: 288 groups, 708 row-context entries, 0 unassigned rows
marketing-sales: 283 groups, 602 row-context entries, 167 unassigned rows
workspace: 62 groups, 131 row-context entries, 2 unassigned rows
unassigned: 180 groups, 404 row-context entries, 184 unassigned rows
```

List rows still needing ACL review:

```bash
files organize list --acl-status needs_review --limit 50 --json
```

Build a read-only owner ACL approval packet:

```bash
files organize approval-packet --root-type shared_drive --owner finance --json
files organize approval-packet --root-type my_drive --owner people --output /tmp/people-my-drive-approval-packet.json
```

The approval packet summarizes the rows that match the owner/root/ACL filters,
top-level folders, MIME mix, duplicate overlap, bounded sample rows, reviewer
commands, and guardrails. It does not update review rows. Use it to collect
owner/reviewer evidence before running `files organize review` with ACL status,
permission scope, or permission risk changes.

2026-06-09 owner-known approval packet evidence archive:

```txt
asset: asset_544ff24ee4b74b07
s3: s3://hasna-xyz-opensource-files-prod/orgs/hasna-xyz/companies/_global/open-files/2026/06/drive-acl-approval-packets/asset_544ff24ee4b74b07/open-files-acl-approval-packets-20260609T051621-0300.tar.gz
sha256: f2a714c64d9c0098de816d3b58ae303377776b02e670a85134f4c26ac6a72449
size: 143,167 bytes
status: verified
```

The archive contains ten read-only JSON packets plus a manifest and checksums:

```txt
shared_drive product: 6,242 rows, 2,276 duplicate rows
shared_drive finance: 3,299 rows, 542 duplicate rows
shared_drive people: 1,415 rows, 261 duplicate rows
shared_drive legal: 729 rows, 418 duplicate rows
shared_drive workspace: 463 rows, 100 duplicate rows
shared_drive marketing-sales: 95 rows, 93 duplicate rows
my_drive marketing-sales: 2,240 rows, 218 duplicate rows
my_drive people: 1,537 rows, 162 duplicate rows
my_drive finance: 406 rows, 116 duplicate rows
my_drive workspace: 119 rows, 12 duplicate rows
```

The archive intentionally excludes the post-unassigned ACL approval task
`424ecee9`; generate that packet only after `988a1e81` assigns owners/targets or
approved exceptions for the remaining 1,667 unresolved My Drive rows.

Summarize rows still missing owner or target placement:

```bash
files organize unassigned --root-type my_drive --json
files organize unassigned --root-type my_drive --include-rows --limit 10 --json
files organize unassigned --root-type my_drive --top-level "USB and External Devices" --include-rows --json
files organize unassigned --root-type my_drive --exclude-top-level "USB and External Devices" --exclude-top-level "Hasna (3)" --json
```

The unassigned summary groups rows by Drive root and top-level folder, reports
root-file and duplicate counts, returns MIME summaries, and assigns a
review-track hint such as `external-device-archive-owner-review` or
`loose-root-file-owner-review`. It does not assign owners automatically.

List high-risk permission rows:

```bash
files organize list --permission-risk high --limit 50 --json
```

Dry-run shared-drive owner/target inference:

```bash
files organize infer-google-drive --root-type shared_drive --json
```

Stage shared-drive owner/target candidates:

```bash
files organize infer-google-drive --root-type shared_drive --apply --json
```

The inference command currently maps only known shared-drive top-level folders:
`Product`, `Finance`, `People`, `Legal`, `Workspace`, and `Marketing & Sales`.
It sets candidate `owner`, `target_path`, labels, and `review_status=in_review`
when missing, but keeps `acl_review_status=needs_review` and
`permission_risk=unknown`.

Dry-run My Drive owner/target inference:

```bash
files organize infer-google-drive --root-type my_drive --json
```

Stage My Drive owner/target candidates:

```bash
files organize infer-google-drive --root-type my_drive --apply --json
```

The My Drive inference command maps only high-confidence business folders:
`HR & People`, `Finance`, `Business Operations`, `Content & Marketing`,
`Shootings`, `Beep Media Deliverables`, `MW VisiSharp German Content - Beep
Media`, and `Creatives Examples`. Ambiguous/personal/mixed My Drive rows remain
unreviewed until a reviewer assigns an owner.

Assign a file owner and destination:

```bash
files organize review <review-id-or-file-id> \
  --status in_review \
  --owner finance \
  --reviewer <agent-or-person> \
  --target-path "Finance/Invoices/..." \
  --label finance \
  --label invoice \
  --note "classified for finance review"
```

Record ACL review:

```bash
files organize review <review-id-or-file-id> \
  --acl-status approved \
  --permission-scope domain \
  --permission-risk low \
  --permission-notes "domain-only access approved by owner" \
  --actor <agent-or-person> \
  --note "ACL reviewed"
```

Mark metadata move complete:

```bash
files organize review <review-id-or-file-id> \
  --status moved \
  --owner finance \
  --target-path "Finance/Invoices/..." \
  --actor <agent-or-person> \
  --note "reviewed and moved as metadata"
```

Review audit events:

```bash
files organize events <review-id-or-file-id> --json
```

Export cutover/audit evidence:

```bash
files organize export --format json --include-events --output ./organization-audit.json
files organize export --format jsonl --output ./organization-audit.jsonl
files organize export --format csv --output ./organization-audit.csv
```

The export includes:

- progress stats and grouped counts by owner, status, root, ACL status, risk,
  and duplicate group,
- unresolved rows,
- moved rows,
- ignored rows,
- permission-risk rows,
- optional event history with `--include-events`.

## Review Process

1. Start with duplicate groups. Use `files organize duplicates` to review
   groups by owner/root, then mark true duplicates as `duplicate` and assign
   the canonical survivor or destination notes in `notes`. Do not auto-mark
   duplicate content as redundant when it represents separate logical files in
   different Drive paths.
2. Review `shared_drive` rows by top-level business area first:
   Product, Finance, People, Legal, Workspace, and Marketing & Sales now have
   candidate owner/target metadata staged. Owners still need to approve ACLs,
   duplicates, and final moved state.
3. Review the remaining 1,667 unassigned `my_drive` rows. Treat personal,
   mixed, external-device, and loose root files as needing owner confirmation
   before marking `approved` or `moved`.
4. For each row, set at least one owner or destination before moving it out of
   the unclassified queue.
5. Review ACL state before retirement. The import does not include full Google
   Drive ACL exports, so bootstrap infers only coarse scope from Drive root:
   `private` for My Drive, `shared_drive` for Shared Drives, and `unknown`
   otherwise. Keep `acl_review_status=needs_review` until an owner or reviewer
   confirms effective permissions.
6. Mark public, external, unknown, or mixed permission rows as high risk or
   external review until they are restricted or approved.
7. Use labels for domain/type (`finance`, `invoice`, `legal`, `contract`,
   `people`, `product`, `archive`, `duplicate`).
8. Prefer assigning destination collection/project ids when the destination is
   already known. Use `target_path` for planned folder placement.
9. Mark rows `moved` only after the destination metadata is set, ACL state is
   acceptable, and the reviewer confirms the file belongs there.
10. Keep `ignored` for files intentionally excluded from operational Drive
   replacement, such as system artifacts, junk metadata, or superseded files.

## Invariants

- Do not rewrite canonical S3 object keys while organizing files.
- Do not delete legacy Drive objects during organization.
- Do not treat `hasna-xyz-prod-emails/drive` as the full Drive source.
- Every review update should use the review command so an audit event is
  recorded.
- Every ACL review update should use the review command so `update_acl_review`
  events are recorded.
- Runtime cutover already proceeded after the review queue bootstrap existed and
  the cutover task explicitly accepted the remaining unreviewed count.

## Next Gates

Runtime defaults have moved to canonical storage. The organization workflow is
still not complete enough for legacy retirement until:

- Drive permission and ACL review is represented in review metadata,
- all rows have moved out of `acl_review_status=needs_review`, or have an
  explicit owner-approved exception,
- audit exports are available for owners/reviewers,
- unreviewed rows have a documented owner workflow,
- cross-account adversarial verification passes,
- legacy storage remains read-only until owner approval.
