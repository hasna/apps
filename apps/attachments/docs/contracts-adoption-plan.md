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

## Concrete implementation map after registry verification

- `src/core/client-config.ts`: retain explicit authority validation and rejection
  of retired selectors/DSNs. Adapt published `resolveCredential`,
  `validateAndSealResolvedCredential` and, for pointer-tier credentials,
  `completePointerCredential`; never reinterpret a missing/failed provider as a
  reason to fall back to environment or local storage. Keep the app-owned
  authority binding alongside the resolved credential rather than reading them
  independently. Verify exact signatures against the published artifact first.
- `src/core/cloud-v1.ts`: JSON requests may use `createClientTransport` with
  `retry: false`; preserve existing list/get envelopes, 404 handling and upload
  metadata. File/stream/source-URL uploads still perform validation before
  consuming input and again before the authenticated dispatch. Preserve
  encryption, presigned transfers, password headers and all share-link options.
- Keep binary downloads in a clearly application-owned adapter. The inspected
  Contracts `HasnaHttpTransport` serializes request bodies as JSON and parses
  responses; it does not expose a raw response stream. Do not fake a JSON
  response or widen Contracts solely to force this use case through that API.
  Resolve the published credential primitives, retain redirect rejection and
  zero retries, and preserve content-disposition validation, content-length,
  password headers and the streaming pipeline to an explicit destination.
- `src/core/todos.ts` and its callers: preserve each service's independent
  credential/authority, including existing `/api/` routes. Do not silently
  rewrite them to `/v1` through a transport normalizer. Use the same app-owned
  bound credential adapter for these legacy route contracts until their
  authoritative service specifications establish another route.
- `scripts/generate-sdk.ts`, both generated copies and `src/sdk/index.ts`:
  inspect the released generator before replacing existing fail-closed template
  patches. Keep credential rotation, auth-header override rejection, manual
  redirect policy and non-disclosing errors; generated provenance must identify
  actual generation and any retained application patching truthfully.

### Stable binding and binary regression requirements

An independent mocked-fetch probe against commit
`7fe76ca2ecab172e12ea78034ab07bc75f705914` exposed a reentrant environment-object
edge: an API-key property accessor changed API_URL while `resolveClientConfig`
was reading the pair, and download dispatched the new key to the old URL.
No network request or output-file write occurred in the probe. Ordinary
`process.env` reads have no intervening await, so this is specifically an
accessor/reentrant supplied-environment case, not a claim that normal key
rotation always races. The follow-up app-owned fix snapshots relevant own data
descriptors once and rejects accessors without invoking them, including aliases,
in Attachments and Todos/Sessions. Twenty-two regressions prove zero getter calls and
zero dispatch while stable between-call rotation still works for JSON, binary
and both integrations. Repeated getter reads are not accepted as stability proof.
This is a synchronous
environment fix, not a claim that unpublished pointer-provider adoption is done.

The adapter must obtain two equal authority/credential snapshots, resolve any
asynchronous pointer, then re-read and compare the exact pair immediately before
calling fetch. Authority remains pinned for the client lifetime; same-authority
rotation is accepted only when stable. Disallow mismatched source/tier/pointer
identity as well as mismatched values. No await may intervene after the final
validation and before dispatch.

Required negative/positive controls:

1. Reentrant key getters changing authority or key, pointer completion changing
   authority, and source/tier changes all produce zero authenticated dispatches.
   Stable same-authority rotation uses the new key on the next request.
2. JSON upload, streaming download and each integration repeat the binding
   controls. Missing/conflicting configuration fails before file/stream input,
   output creation or network access; pointer failures never fall through.
3. 301/302/303/307/308 never forward credentials or replay bodies, including
   same-origin redirects. 401/403 errors never read or expose credential-bearing
   response bodies. Network/5xx failures produce one attempt, not implicit retries.
4. Binary bytes, download filename/length, password headers, streaming behavior,
   upload metadata/encryption and presigned/share-link features survive unchanged.
   Integration requests preserve their own authority and existing API paths.
