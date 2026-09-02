# Canonical Contracts adoption: release gate

Attachments 2.0.0 is a prepared breaking version, not a published release.
The scoped major changeset `attachments-canonical-client-major` was recorded and
applied only to this package; unrelated pending changesets remain untouched.

## Source-backed dependency inventory

Current production imports from `@hasna/contracts/auth` are `ApiKeyStore`
(`src/serve/index.ts`), `verifyApiKey` and `ApiKeyVerifier`
(`src/serve/app.ts`), and `apiKeyMigrations` (`src/db/migrations.ts`).
Server tests also import `mintApiKey`. The package dependency is still `^0.8.2`;
the standalone lock resolves 0.8.7. The manifest and packed-artifact scanner
remain explicitly pinned to 0.8.2. No 1.0.0 registry dependency is claimed.

`src/server-storage` is application-owned code derived from 0.8.2 with reviewed
TLS, transaction and migration protections. It must not be relabeled as a newly
generated kit. The HTTP client and credential boundary are likewise currently
application-owned, not proof of canonical shared-provider adoption.

Reviewed candidate Contracts source at commit
`453b0521a194dd65a6b69eaaf07aa7c3bcf6fd14` declares version 1.0.0 and exports
`./auth`, `./client`, `./client/storage`, `./sdk` and `./kit`. Its `./client`
exports credential resolution and sealed credential validation through the HTTP
transport. Source availability is not registry availability or artifact proof.

## Required adoption sequence

1. Verify the published Contracts 1.0.0 tarball, version, integrity and reviewed
   commit. Do not pin an absent version or substitute an unpublished worktree.
2. Audit the actual exported auth signatures and migration SQL against current
   call sites and stored schema. Preserve tenant auth, key verification and all
   existing auth migrations; prove upgrade/idempotence/checksum behavior on live PG.
3. Wire the released `./client` credential/transport seam into all authenticated
   client dispatch paths, including binary upload/download and Todos/Sessions
   integrations. Retain same-authority rotation, reject authority changes,
   disable redirects and unsafe retries, and reject retired client storage inputs.
4. Reconcile generated SDK and kit output using the released generator. Compare
   every application-owned TLS/migration fix before adopting generated output;
   do not overwrite these protections or misstate provenance.
5. Update the dependency, manifest kit version, scanner pin and their regression
   assertions together, then regenerate root and standalone locks without
   unrelated dependency churn. Resolve deprecated Paths packaging separately
   against an authoritative published artifact; never guess a replacement version.
6. Repeat the full 65-check harness, real redirect/credential tests, live PG gate,
   conformance, generated-artifact check, isolated consumer/type checks and final
   npm tarball scan. Obtain independent review of the exact resulting commit.

## Current evidence and remaining boundary

At pre-version commit `831ffb9c8c2c9ee88d5591fca33de794ce204677`, root CI run
33618602968 passed the required missing-database control and all 15 live PG tests
without skips (52 assertions). This proves the current application-owned pool,
migrations and store, not future shared-kit adoption or a deployed object store.

Version 2.0.0 must receive a fresh exact-artifact audit after final dependency
adoption. No npm publication, deployment, production migration or legacy-data
import is performed by this version preparation.
