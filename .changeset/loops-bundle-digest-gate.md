---
"@hasna/loops": patch
---

Loop bundle digest gate: verify on every run, and let only the per-run flag past it (follow-up to hasna/apps#1751, review NO_GO).

The executor memoised its "this tree is clean" verdict under a key built from the bundle DIRECTORY's `stat`. A directory's stat moves when entries are added, removed or renamed and at no other time, so rewriting `scripts/run.sh` in place left the key byte for byte identical: the daemon — one long-lived process — went on spawning the tampered script under the pre-tamper verdict for the rest of its lifetime, and stamped the stale digest onto every receipt. The memo is gone. Verification re-reads the tree on each resolution (O(bundle bytes), capped at 8 MiB by `collectBundle`), and the drift tests now exercise the production path instead of opting out of the cache.

Three more fixes in the same gate:

- `target.allowDirtyBundle` persisted on a loop row is no longer honoured. `target` is an unvalidated passthrough, so it let any principal with `loops:write` switch the digest gate off for a loop permanently, with no CLI flag and no distinct audit event. `loops run-now --allow-dirty` stays the only bypass, per run.
- A run receipt's `bundle.digest` is now recomputed from the tree that actually ran, not read out of `manifest.json` — an `--allow-dirty` run used to attest the clean digest of content that did not execute.
- `loop_revisions.storage_kind` is derived from the placement that was chosen instead of being hard-coded `s3`, so an install with no `HASNA_LOOPS_ARTIFACTS_BUCKET` stops labelling local-disk objects as S3 ones; revision completeness now keys on the recorded storage key, which gives the no-bucket path the same missing-object detection the hosted one has.

New migration `0017_run_receipts_loop_cascade_repair` makes the run-receipts cascade FK correct on a database that carries it under a non-canonical name. 0015 drops that FK by the name Postgres auto-assigned in `0010_tenant_enforce`, so a database rebuilt by another route (a `pg_dump` of a hand-repaired schema, a logical restore) can end up with the old non-cascading key still in place. 0017 is name-agnostic and idempotent: it drops any non-cascading run_receipts -> loops FK whatever it is called and adds the canonical cascading one only if none is present, so it is a no-op on a healthy database. 0015 itself is untouched — it shipped in `@hasna/loops` 0.6.3 and 0.6.5 and is applied on the hosted database, so its bytes and its ledger checksum are frozen; a repair to a released migration is a new migration.
