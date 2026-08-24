---
"@hasna/contracts": patch
---

storage-kit check now fails when only the manifest records a stale kitVersion (todos row OPE61-00024). Previously checkKit() folded only template-file hash statuses, extras, and dependency-minor drift into `ok`, so a manifest-only stale version printed "ok storage-kit check" and exited 0 in the CLI. `staleVersion` is now part of the ok aggregate.
