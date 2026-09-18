# Current Emails server deployment

This lane replaces the complete live `emails` container image with the exact
current `main` source. It does not publish `@hasna/emails`, mutate the database,
or reuse the historical three-file overlay as the candidate image.

Normal sequence:

1. Require successful `ci` for the exact current `main` commit.
2. Run the protected search lane with `phase=reconcile` against the independently
   reviewed historical preparation. Review and hash the emitted
   `emails-search-reconciled/reconciled.json`.
3. Dispatch `emails-current-server-deploy` on `main` with that reconciliation
   run id and the SHA-256 of the exact `reconciled.json` bytes.
4. The workflow rechecks exact-main CI and reconciliation before and after the
   production boundary, proves the migration source is byte-identical to the
   reconciled live source, exercises the full amd64 image against isolated
   PostgreSQL, rejects HIGH/CRITICAL image findings, pushes one immutable tag,
   and registers an image-only clone of the reconciled task.
5. The workflow proves the routed `/version`, `/ready`, and `/openapi.json`
   contract at exactly `https://api.hasna.com/emails`. API resource paths carry
   one `/v1`; no client base URL includes `/v1`.
6. Separately prove authenticated provider reads and fail-closed client authority
   from an owner workstation without printing the key or response rows. Only
   after all proofs pass may the independent release PR be reconsidered.

No automatic retry or rollback is performed after an uncertain ECS write. The
metadata receipt identifies the previous and candidate task definitions for a
separate reviewed reconciliation.
