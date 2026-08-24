---
"@hasna/knowledge": patch
---

Add `knowledge versions purge --id <id> [--rev <n>] --yes` to permanently scrub retained prior versions that carry credential-shaped values (OPE60-00006). The operation deletes by id/version without ever reading the retained body; the live row is never a purge target.
