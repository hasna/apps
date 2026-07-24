---
name: open-files-migration-operator
description: "Operate the open-files Google Drive migration safely. Use when Codewith needs to continue files-first migration work, inspect or update organization metadata, verify canonical S3 mappings, run redacted audits, preserve legacy buckets, coordinate local SQLite/Postgres sync, or explain what remains after metadata organization."
---

# Open Files Migration Operator

## Current Invariants

- Canonical repo bucket: configured via `HASNA_FILES_S3_BUCKET` (operator env, not a literal in this repo).
- Canonical bytes live under `objects/sha256/...`.
- Google Drive import and legacy sources stay readable until final retirement.
- Organization is metadata-first: owner, `target_path`, labels, review status, duplicate status, permission metadata.
- Do not rewrite S3 keys for organization.
- Do not print private filenames, paths, object keys, file contents, ACL payloads, or secret values in shared output.

## Standard Checks

```bash
files organize stats --json
files organize apply-drive-policy --json
python3 .codewith/skills/open-files-corpus-reader/scripts/mime_coverage_audit.py
```

Expected local post-policy state as of 2026-06-15:

```text
total review rows: 18,212
approved survivor/non-duplicate rows: 15,648
duplicate non-survivor rows: 2,564
duplicate groups: 1,818
missing owners: 0
missing targets: 0
ACL needs review: 0
high-risk permissions: 0
```

## Migration Workflow

1. Verify metadata idempotence.
   - `files organize apply-drive-policy --json` should report `planned_updates: 0`.

2. Audit extraction coverage.
   - Use `open-files-corpus-reader`.
   - Prioritize `intake`, `personal-review`, `archive`, legal, finance, and people.

3. Review semantic renames.
   - Use `open-files-semantic-renamer`.
   - Apply only reviewed metadata updates.

4. Push/sync to production metadata store only after DB/RDS path is approved.
   - Verify row counts before and after sync.
   - Export audit evidence.

5. Keep legacy safe.
   - Legacy/import buckets are backup sources.
   - No retirement until final cross-account object resolution, app download checks, rollback window, and user approval.

## Evidence

Read `references/current-state.md` for the latest recorded aggregate state.
