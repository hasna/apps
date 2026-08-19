---
"@hasna/releases": patch
---

Add a fail-closed selective Changesets candidate planner that accepts explicit Changeset IDs and a package allowlist, validates dependency closure before writes, supports dry-run and apply, and preserves unrelated Changesets and manifests byte-for-byte.
