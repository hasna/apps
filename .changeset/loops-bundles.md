---
"@hasna/loops": minor
---

Loop bundles: a loop's definition and its scripts on disk, published as immutable `loop@version` artifacts, with an append-only revision ledger (hasna/apps#1724).

A loop has always been a database row, and the row stays the runtime authority. But a loop may carry *scripts*, and a row cannot — which is why `loops hygiene scripts` reports every command target referencing `~/.hasna/loops/scripts` as a defect: such a loop is by definition un-portable. Bundles are the fix.

**On disk.** `~/.hasna/loops/loops/<bundle-name>/` holds `loop.json` (the definition), `manifest.json` (per-file sha-256, the bundle digest, provenance), `scripts/` (0700 executables referenced relative to the bundle root) and an optional `README.md`. Modes are contract, not umask: `scripts/**` is 0700, everything else 0600. The root resolves through the existing Loops path resolver; no new environment switch is introduced.

**Two digests, deliberately.** `bundleDigest` names the content (sorted `mode sha256 size path` lines) and is independent of tar framing, so re-packing an unchanged tree is provably idempotent; `archiveSha256` names the `bundle.tar.zst` bytes on the wire. Skills' single-digest model could not express an idempotent re-push.

**In the database.** New `loop_revisions` (pg `0016_loop_revisions`, sqlite `0017_loop_revisions`) is append-only at the privilege level — the runtime role gets `SELECT` and `INSERT` and no `UPDATE` or `DELETE`. `loops.bundle_name` (unique per tenant, because loop names are not) and `loops.bundle_pinned_version` point into it. `run_receipts.bundle_json` records which bundle version produced a run. All additive and nullable: an older `loops-serve` binary keeps scheduling unchanged.

**In object storage.** `loops/<tenant>/<bundle-name>/<version>/{bundle.tar.zst,manifest.json}` plus a mutable `latest.json` pointer, keyed by `HASNA_LOOPS_ARTIFACTS_BUCKET`. Version objects are never overwritten; the version is allocated inside the insert transaction, so two concurrent pushes get two versions and neither can address the other's key. With no bucket configured the artifacts fall back to a local directory under the Loops data home, so an install with no object store can still push, pull and roll back.

**API.** `GET /v1/loops/{id}/versions`, `GET /v1/loops/{id}/versions/{version}`, `POST /v1/loops/{id}/versions` (multipart, strict two-part discipline), `GET /v1/loops/{id}/versions/{version}/bundle`, `POST /v1/loops/{id}/rollback`, `POST /v1/loops/{id}/pin`, `GET /v1/bundles`. Rollback is forward-only: it applies the earlier definition and appends a new revision with `rolledBackFrom` set, so nothing in the ledger is ever rewritten. A new `loops:bundle` scope gates every surface that can materialise an agent prompt, `machine` tokens are excluded from the bundle routes entirely, and no presigned URL is ever returned — the server streams the object itself. `API_CAPABILITIES` gains `"bundles"` for feature detection.

**CLI.** `loops bundle init|push|pull|versions|pin|sync|materialize|status|diff`, with `loops init|versions|pin|sync|materialize` as top-level aliases. `loops push`/`loops pull` dispatch to the bundle verbs only when given a positional bundle name; with no positional they keep the shipped control-plane row backfill and warn that it moves to `loops migrate {push,pull}`. `push` refuses (exit 2) any tree the write-path secret scrubber would change, naming the path and byte offset and never the value; there is deliberately no `--allow-secrets`.

**Executor.** For bundled loops only: the bundle root is the default cwd, relative commands resolve against it (bare PATH names still work), a resolved path that escapes the bundle refuses the run, and the tree's digest is verified before every run — drift fails with `BUNDLE_DRIFT` naming the changed paths and spawning nothing, bypassable only with `--allow-dirty`. A missing bundle fails with `BUNDLE_MISSING` rather than silently falling back to PATH.
