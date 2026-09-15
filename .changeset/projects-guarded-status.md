---
"@hasna/projects": patch
---

Expose `--status` on `projects guarded-update` so registry status changes use the existing revision, idempotency, dry-run, receipt, and rollback controls. Status changes preserve project content and reject invalid values.
