---
"@hasna/emails": patch
---

Fix the PG unread-by-address integration test to the measured parity contract: a message carrying cc recipients still counts for its to-recipients, so first@example.test rolls up 3 (not 2) with the given fixture; the is_read:true message stays excluded (without the exclusion the count would be 4). Both the local SQLite rollup and the PG store return 3 for this fixture — the assertion contradicted its own data. The version-wave pool (#602) computes the single @hasna/emails 1.3.17 bump from all pooled changesets; this per-PR changeset is an input to that pool, not a separate version.
