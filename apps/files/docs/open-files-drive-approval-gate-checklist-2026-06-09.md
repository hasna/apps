# Open Files Drive Approval Gate Checklist - 2026-06-09

Scope: consolidated, read-only checklist for the remaining Google Drive
replacement approval gates in plan `408795a5`.

This document does not approve gates, assign owners, set target paths, approve
ACLs, mark duplicate survivors, mark files moved, rewrite S3 keys, change
secrets, or change canonical Postgres.

## Current State

The current Drive replacement review state is intentionally not final:

```txt
Imported Drive rows: 18,212
Rows staged in_review: 16,545
Rows still unreviewed/unassigned: 1,667
Rows still missing target placement: 1,667
Rows still needing ACL review: 18,212
Rows still permission_risk=unknown: 18,212
Duplicate-review rows: 4,382
Canonical S3 bucket: hasna-xyz-opensource-files-prod
Canonical object prefix: objects/sha256/
Final audit gate: 617a5bb0
Top-level Drive replacement gate: 2b590b38
```

Latest task-state refresh: 2026-06-11T11:49:09+03:00.

```txt
Open-files project: 144 total / 32 pending / 0 in_progress / 112 completed
Drive replacement plan 408795a5: 95 total / 32 pending / 0 in_progress / 63 completed
Pending Drive approval records: 32 pending / 0 missing
Ready Drive approval queue: 24 tasks
Separate ready open-files non-Drive tasks: 0
```

The refresh confirms the count drift since the previous approval packet is from
completed read-only readiness tasks, graph/evidence refreshes, and the
documentation refresh task `c1293c3d`, not from owner/ACL/duplicate/moved-state
approval progress. Task `aa0d6816` re-audited the duplicate-unassigned lane and
left the reviewer packet shape unchanged; task `cb4f3a27` re-audited the My
Drive People ACL lane and left ACL state unchanged; task `b40de4c6` re-audited
the My Drive Marketing/Sales ACL lane and left ACL state unchanged; task
`70b6f2cc` re-audited the My Drive Finance ACL lane and left ACL state
unchanged; task `4c7da031` re-audited the My Drive Workspace ACL lane and left
ACL state unchanged; task `02304ae5` re-audited the shared-drive Legal ACL lane
and left ACL state unchanged; task `541c0670` re-audited the shared-drive
People ACL lane and left ACL state unchanged; task `277c243f` re-audited the
shared-drive Finance ACL lane and left ACL state unchanged; task `9e0a98c4`
re-audited the shared-drive Product ACL lane and left ACL state unchanged; task
`193bf82a` re-audited the shared-drive Workspace ACL lane and left ACL state
unchanged; task `634ef07a` re-audited the shared-drive Marketing/Sales ACL lane
and left ACL state unchanged. No Drive review rows, ACL/risk states, duplicate
states, moved flags, canonical Postgres rows, S3 objects, S3 keys, or legacy
sources changed.

Evidence:

```txt
/tmp/open-files-drive-pending-tasks-after-refresh-2026-06-10.tsv
sha256: 2c6b9f069ab9f2e7ba30d33682ca59d85e6785cbc52a722353c3318ea89e30a3

/tmp/open-files-drive-approval-gates-after-refresh-2026-06-10.tsv
sha256: 2ff29cc49e025905a8d40cc39c9a74fddcd705aa8f54c78be8ec329ea4b54533

/tmp/open-files-drive-ready-refresh-summary-2026-06-10.txt
sha256: af0ed3d6948745c27ae8fb93de37b53db582bbe887df8edd89cae8639b141b0c

/tmp/open-files-drive-ready-refresh-after-aa0d6816-2026-06-11.tsv
sha256: 5e1136a3f4d4184a6956db7a4a14dce5626af3fd3faf4b2f2e8a5931e7982a53

/tmp/open-files-drive-ready-refresh-after-people-acl-audit-2026-06-11.tsv
sha256: 62cde786b48fd24bf0e176ff3d29c4a3de113eb6390487000e816c738e8020b9

/tmp/open-files-drive-ready-refresh-after-marketing-sales-acl-audit-2026-06-11.tsv
sha256: 3c5580b9087fa876de61e2907a65a4bb282df01814d8f88afd893534f8d67a07

/tmp/open-files-drive-ready-refresh-after-finance-acl-audit-2026-06-11.tsv
sha256: 206b78c6948e0fec22194e2e2da0e4b1c3965f244f60cae8dafd646d0c5154d1

/tmp/open-files-drive-ready-refresh-after-workspace-acl-audit-2026-06-11.tsv
sha256: a7ca15a0bda37a270570e042b82d265aeb562c6540045db63a9228d91a0cd7c2

/tmp/open-files-drive-ready-refresh-after-shared-drive-legal-acl-audit-2026-06-11.tsv
sha256: c3b45279e398278b95b5144b5c47bd60f85c9d81dac55542e037f40396d88b36

/tmp/open-files-drive-ready-refresh-after-shared-drive-people-acl-audit-2026-06-11.tsv
sha256: 23e9eb6911f5cc44da44d7f5d0ae3e132061ae57041aca5fa2898f0f53ebd19c

/tmp/open-files-drive-ready-refresh-after-shared-drive-finance-acl-audit-2026-06-11.tsv
sha256: ac5bffcfbd6c4322ac5a9d79deca635d832092efd61b95d1ae105378b01c36a0

/tmp/open-files-drive-ready-refresh-after-shared-drive-product-acl-audit-2026-06-11.tsv
sha256: df987101a6918931f06a423a74af75eda09f9eb7726517ceec67addb1bd72e0b

/tmp/open-files-drive-ready-refresh-after-shared-drive-workspace-acl-audit-2026-06-11.tsv
sha256: 4475134ffcaa39c4d17853847c1d666968fb9f6b64f832f2ae0c49978f93e073

/tmp/open-files-drive-ready-refresh-after-shared-drive-marketing-sales-acl-audit-2026-06-11.tsv
sha256: c8b00da750cff2a7a74b84b9dd9089b27b4ec1d469ad0eaab96a3ea54764bb3f
```

The final audit task `617a5bb0` must stay pending until unresolved rows are
zero or owner-approved exceptions exist, ACL/risk state is approved, duplicate
decisions are recorded, moved-state metadata is approved, and local/canonical
Postgres counts match.

## Evidence Archives

These archives are already generated and verified in canonical S3:

| Evidence | Asset | SHA-256 | Scope |
| --- | --- | --- | --- |
| My Drive unassigned review packets | `asset_e3906bfbb4c447fb` | `e7977ac67e9a6b8a26347aa4d16cb0993c6572a28ac60c6195926ba9dbf80f6a` | 7 packets / 1,667 unresolved My Drive rows |
| Duplicate review packets | `asset_b5083d47177f475c` | `0ac6db1f70b7d18d4be9036af15552e4f3db3b1b3238353495b461c3b563aa0e` | 7 packets / 1,818 duplicate groups / 4,382 duplicate-review rows |
| Owner-known ACL approval packets | `asset_544ff24ee4b74b07` | `f2a714c64d9c0098de816d3b58ae303377776b02e670a85134f4c26ac6a72449` | 10 packets / 16,545 owner-known rows |

Canonical S3 locations are recorded in
`docs/open-files-drive-organization-workflow.md`.

## Approval Order

Recommended order:

1. Resolve the seven My Drive owner-assignment packets under `988a1e81`.
2. Resolve duplicate survivor/exception packets under `c1b639c8`, coordinating
   any unassigned rows with step 1.
3. Approve owner-known shared-drive and My Drive ACL packets under `10e93c88`
   and `8fe1f56c`.
4. Generate and approve the post-unassigned My Drive ACL packet `424ecee9`
   after `988a1e81` assigns owners/targets or approved exceptions.
5. Approve moved-state metadata task `28e9e358` only after owner, ACL, and
   duplicate gates are complete.
6. Export final audit `617a5bb0` and verify local/canonical Postgres counts.
7. Use the final audit to unblock central migration verification, RDS freeze
   readiness, and legacy retirement review.

## My Drive Owner Assignment Gates

Gate name: `drive-owner-assignment-approval`

Parent: `988a1e81` - resolve 1,667 remaining unassigned My Drive rows.

| Task | Packet | Rows | Duplicate rows | Prep doc | Doc SHA-256 |
| --- | --- | ---: | ---: | --- | --- |
| `47db3f15` | USB and External Devices | 1,300 | 3 | `docs/open-files-my-drive-usb-external-devices-review-prep-2026-06-09.md` | `0ed332565ed9bed06c261863bab91879e1b610341fd80d3a3525aa9690a685b2` |
| `fd25524e` | Hasna (3) | 180 | 166 | `docs/open-files-my-drive-hasna-3-review-prep-2026-06-09.md` | `de9319f84d8de41a62d8bb55fc7fe389150a6fb70537f27e2588983234d8f463` |
| `745d55d9` | Archive | 20 | 1 | `docs/open-files-my-drive-archive-review-prep-2026-06-09.md` | `8eb9c8ed9be7f0c1b4a2ad9d7089c9ac09f8330a11672b4fc291dc9bcf3a075c` |
| `12894a18` | Signed Affidavit and Testimonials | 17 | 0 | `docs/open-files-my-drive-affidavit-testimonial-review-prep-2026-06-09.md` | `d160af816f80d84b713b11a07de23deae89960c5c8a77e8c4761141acf3edbe6` |
| `c4cbfd85` | Pentru Diana & Andrei | 16 | 0 | `docs/open-files-my-drive-personal-mixed-review-prep-2026-06-09.md` | `257a71f5aef9334d748b0fd8bce6fc7cf127681040c2761487e43d3e6a65fa7f` |
| `6383c787` | Hasna | 15 | 0 | `docs/open-files-my-drive-hasna-review-prep-2026-06-09.md` | `21145d666f6bf6cae8ad5a29dc14f8d03a1f67a6fb0e06c356ad38a0f6634a8a` |
| `8fabb7b2` | Remaining small folders and loose root files | 119 | 14 | `docs/open-files-my-drive-small-loose-review-prep-2026-06-09.md` | `0313cc3cbb833b3a1d2ed048e1c10b15d0aade9ad574e39d731418057863ee8f` |

Reviewer decision needed for each packet:

- Assign a business owner and target placement, or record an explicit approved
  exception.
- Coordinate duplicate-overlap rows with the duplicate survivor gates before
  marking duplicate state.
- Keep ACL/risk state unchanged in this gate; ACL approval is separate.

## Duplicate Survivor Gates

Gate name: `drive-duplicate-survivor-approval`

Parent: `c1b639c8` - resolve Google Drive duplicate groups and canonical
survivors.

| Task | Packet | Groups | Row-context entries | Unassigned rows | Prep doc | Doc SHA-256 |
| --- | --- | ---: | ---: | ---: | --- | --- |
| `6956c109` | Product | 925 | 2,391 | 3 | `docs/open-files-duplicate-product-review-prep-2026-06-09.md` | `dd29a29dfa70267cc7aedbb53c9ad595994a7dc6ff2786a805f5b045e1f191cc` |
| `8c29bd6b` | Finance | 404 | 966 | 10 | `docs/open-files-duplicate-finance-review-prep-2026-06-09.md` | `e336746d9d025acb0e1bd827bf67af8e29df4c1f5fedde6438c301e45da49830` |
| `f285ba84` | People | 238 | 496 | 0 | `docs/open-files-duplicate-people-review-prep-2026-06-09.md` | `a417fd70ca14fe65ddd3c5db190ba5aaae5e8499fbd53c7558223a6f7a5f49ee` |
| `704f037f` | Legal | 288 | 708 | 0 | `docs/open-files-duplicate-legal-review-prep-2026-06-09.md` | `a0dcb98e814fa2a5358c975c6f049cafc66e62a890a53adc7944dbafe40d1591` |
| `6cb4bd04` | Marketing/Sales | 283 | 602 | 167 | `docs/open-files-duplicate-marketing-sales-review-prep-2026-06-09.md` | `cb8d1273d6f303677e474afbb71b2b9889959562e32fcbf4c5849ee389b96cb3` |
| `9025f930` | Workspace | 62 | 131 | 2 | `docs/open-files-duplicate-workspace-review-prep-2026-06-09.md` | `98bf7fc65b3e830d39fada029971f013b64a64176b736201c2b4d80cb34ad49a` |
| `62a7ecf3` | Unassigned duplicate groups | 180 | 404 | 184 | `docs/open-files-duplicate-unassigned-review-prep-2026-06-09.md` | `e12fbb855ad3121739f0c8fb25d8f7656db173218580b7369166781ec28d8e69` |

Reviewer decision needed for each packet:

- Confirm canonical survivor metadata or true duplicate/exception state.
- Do not rewrite content-addressed S3 object keys.
- Resolve unassigned duplicate rows through owner-assignment approval where
  needed.
- Leave ACL/risk changes to the ACL approval gates.

## Shared-Drive ACL Gates

Gate name: `drive-acl-owner-approval`

Parent: `10e93c88` - collect shared-drive owner ACL approvals by business area.

| Task | Owner | Rows | Duplicate-overlap rows | Prep doc | Doc SHA-256 |
| --- | --- | ---: | ---: | --- | --- |
| `e4cb7380` | Product | 6,242 | 2,276 | `docs/open-files-acl-shared-drive-product-review-prep-2026-06-09.md` | `84e666d7a27673e17c804ad10c840c50d7a34bd8cd5039ae0f4237116dbc9900` |
| `d417db6d` | Finance | 3,299 | 542 | `docs/open-files-acl-shared-drive-finance-review-prep-2026-06-09.md` | `9683d7761c3afb025ae4af3b3466f0cf1b3b2f193ea3c57ea51d15fac313997a` |
| `198f4cbe` | People | 1,415 | 261 | `docs/open-files-acl-shared-drive-people-review-prep-2026-06-09.md` | `f28ef3b2a291eb11621fc364d6e20d3df880a617e643c2ffe397993dca541d63` |
| `12163ddc` | Legal | 729 | 418 | `docs/open-files-acl-shared-drive-legal-review-prep-2026-06-09.md` | `da58ec854d226ca0f43f4b846b5126bd20b7fe120a04de596f14a7c217ab01bf` |
| `92b5f940` | Workspace | 463 | 100 | `docs/open-files-acl-shared-drive-workspace-review-prep-2026-06-09.md` | `07f99efd274b1c1d1f2f79e09faa235c95ff982cebbdffd7ab777396c2b73854` |
| `187bb5fa` | Marketing/Sales | 95 | 93 | `docs/open-files-acl-shared-drive-marketing-sales-review-prep-2026-06-09.md` | `0d206fb86e69323b0b36e3bf975b2e97b447fcfee2e7c9b3dcbf2d6fed86ca37` |

Reviewer decision needed for each packet:

- Confirm effective permissions are acceptable for open-files replacement.
- Approve any change from `acl_review_status=needs_review` and
  `permission_risk=unknown`.
- Coordinate duplicate-overlap rows with duplicate survivor decisions.
- Do not mark files moved from this gate.

## My Drive ACL Gates

Gate name: `drive-acl-owner-approval`

Parent: `8fe1f56c` - collect My Drive owner ACL approvals.

Owner-known packets:

| Task | Owner | Rows | Duplicate-overlap rows | Prep doc | Doc SHA-256 |
| --- | --- | ---: | ---: | --- | --- |
| `c857dbc2` | Marketing/Sales | 2,240 | 218 | `docs/open-files-acl-my-drive-marketing-sales-review-prep-2026-06-09.md` | `1855abcc242f5b8d46bc5dfb7c87643a014199bcc85bfadbac6e962c687a7ed4` |
| `b054dcf6` | People | 1,537 | 162 | `docs/open-files-acl-my-drive-people-review-prep-2026-06-09.md` | `53c7f6c925caedbc53499f9ad0807060e275c208ec351602ede1b69fdcdf53c5` |
| `2b00315b` | Finance | 406 | 116 | `docs/open-files-acl-my-drive-finance-review-prep-2026-06-09.md` | `fc9efcbaa948e608a5060b07a8b704550a2381862a8ea84c6e1e8511002dd8a9` |
| `95ab0a9f` | Workspace | 119 | 12 | `docs/open-files-acl-my-drive-workspace-review-prep-2026-06-09.md` | `3ba1e81e1698d2d8bff949c807cc9db9b33110a3e8a83f337cc5b73687dc8beb` |

Post-unassigned packet:

| Task | Scope | Status |
| --- | --- | --- |
| `424ecee9` | My Drive rows assigned by `988a1e81` | Blocked until owner assignment or approved exceptions exist for the 1,667 unresolved rows |

Reviewer decision needed:

- Owner-known packets can be reviewed now, but completion still requires the
  `drive-acl-owner-approval` gate.
- `424ecee9` must not be generated or approved until owner-assignment outputs
  exist for `988a1e81`.
- ACL approvals do not mark moved state and do not rewrite S3 keys.

## Moved-State Gate

Gate name: `drive-metadata-move-approval`

Task: `28e9e358` - mark approved Drive organization rows moved as metadata.

This task is intentionally downstream of:

- duplicate survivor decisions (`c1b639c8`),
- shared-drive ACL approvals (`10e93c88`),
- My Drive ACL approvals (`8fe1f56c`).

Only metadata should change in this gate. Canonical S3 keys under
`objects/sha256/` remain immutable, and legacy Drive/S3 sources remain readable
until central retirement gates close.

## Final Audit And Central Blockers

The final audit `617a5bb0` must prove one of these states:

- `unresolved_count=0` and `permission_risk_count=0`, or
- every remaining unresolved/risk row has an explicit owner-approved exception.

It must also verify local and canonical Postgres counts match and upload the
final audit evidence to `hasna-xyz-opensource-files-prod`.

Until `617a5bb0` completes, these central migration tasks remain blocked:

| Central task | Why it stays blocked |
| --- | --- |
| `de9ca453` | Cross-account adversarial migration verification needs final open-files audit evidence. |
| `24adad56` | Legacy retirement verification needs final open-files audit evidence. |
| `6c10c2a1` | Legacy bucket/secret/RDS retirement must wait for final verification and rollback windows. |
| `a7cd0d4c` | Legacy RDS read-only freeze depends on final Drive audit evidence plus snapshots/checks. |

## Non-Negotiable Guardrails

- Do not run state-changing `files organize review` commands before the
  matching approval gate is approved.
- Do not mark tasks complete just because read-only prep exists.
- Do not lower `permission_risk` or change `acl_review_status` without owner
  approval evidence.
- Do not mark duplicate survivors or true duplicates without duplicate-survivor
  approval evidence.
- Do not mark rows moved until owner, ACL, duplicate, and metadata-move gates
  are satisfied.
- Do not rewrite canonical S3 object keys.
- Do not delete or retire legacy Drive/S3/RDS resources before central
  adversarial verification and rollback windows complete.
