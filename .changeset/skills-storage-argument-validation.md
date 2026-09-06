---
"@hasna/skills": patch
---

Reject unexpected positional arguments to `storage status`, `storage sync-plan`, and `storage migrate` before their handlers run. Invalid invocations now exit unsuccessfully without creating storage directories, reading the snapshot, or migrating the owner layout; valid options and commands retain their existing behavior.
