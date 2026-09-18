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
4. The caller rechecks exact-main CI and reconciliation, then delegates to the
   IAM trust-bound `emails-search-promotion-execute` reusable workflow. That
   sanctioned production job rechecks the same evidence, exercises the full amd64
   image against isolated PostgreSQL, rejects HIGH/CRITICAL image findings,
   pushes one immutable tag, compares the actual OCI migration definition inputs,
   and registers an image-only clone of the reconciled task only on equality.
5. The workflow proves the routed `/version`, `/ready`, and `/openapi.json`
   contract at exactly `https://api.hasna.com/emails`. API resource paths carry
   one `/v1`; no client base URL includes `/v1`.
6. Separately prove authenticated provider reads and fail-closed client authority
   from an owner workstation without printing the key or response rows. Only
   after all proofs pass may the independent release PR be reconsidered.

No automatic retry or rollback is performed after an uncertain ECS write. The
metadata receipt identifies the previous and candidate task definitions for a
separate reviewed reconciliation.

A reconciliation may remain admissible across later exact-main commits only when git proves that no Emails source, deployment workflow, current-deploy control, or historical search-promotion control changed. The current main tip must still have its own completed successful CI run; any relevant-path change requires a new reconciliation.

# Immutable image migration admission

The image-only deployment compares migration inputs from the **actual deployed
and candidate immutable OCI images** before registering a task or updating ECS.
The source commit of an overlay recipe cannot establish what definitions its
base image contains.

The gate accepts OCI and Docker schema-2 manifests with their corresponding
config and gzip-layer media types; indexes and unknown formats refuse. It
verifies original manifest/config/layer digests and uncompressed diff IDs,
applies whiteouts, and reads only bounded regular files without extracting or
executing image code. It compares Emails' migration module, its storage helper
and export modules, and the installed `@hasna/contracts/auth` bundle. The auth
package must resolve to the reviewed export target; image-local resolver config,
shadow modules, links,
unknown imports, unsupported export conditions, and missing inputs refuse.
Import parsing uses a trusted Bun parser with no inherited credentials.

This is deliberately a **conservative byte comparison**, not semantic SQL
equivalence. Unrelated edits within the auth bundle or storage modules also
refuse. New module layouts require review of the gate. Database-driver behavior
and general application code are outside this migration-definition comparison;
the existing runtime smoke, vulnerability, readiness and deployment gates remain
required. This lane never runs a migration or bypasses readiness.

`migration-admission.json` records both image digests, verified definition-input
hashes and the comparison result, including a completed comparison that refuses.
Successful registration/deployment receipts bind its SHA256. Actual healthy
task image digests and the stable service are rechecked immediately before
registration; the existing pre-update service guard remains in place.

Run synthetic regression tests without AWS or database access:

```sh
python3 -I -B tooling/deploy/emails-current/migration_admission_test.py
```
