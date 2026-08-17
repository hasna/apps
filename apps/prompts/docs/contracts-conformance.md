# Contracts conformance status

`hasna.contract.json` declares this repo against `hasna.service_contract.v1`. The gate is
`bun run contracts:check` (`@hasna/contracts@0.10.6 repo-conformance .`).

**`bun run contracts:check` currently exits 0.** Every conformance check passes after the
storage-core patch (`feat(prompts): two-backend storage core + markdown body store + /v1`):

- `surface_matrix` — the `api` surface is `supported` with `apiBasePath: /v1` and
  `openApiPath: /openapi.json`; the `sdk` surface is `supported` at `./sdk`,
  generated from `/openapi.json` (`scripts/generate-v1-sdk.mjs`).
- `service_api_topology` — `prompts-serve` implements `GET /health`, `GET /ready`,
  and `GET /version`.
- `self_host_artifact` — the repo ships a `Dockerfile`.
- `storage_capabilities` — `storage.engines: [sqlite, postgresql]` is real: the server
  selects PostgreSQL from `HASNA_PROMPTS_DATABASE_URL` via the vendored storage kit
  (`src/generated/storage-kit`), the PostgreSQL schema lives in
  `src/db/pg-migrations.ts`, and the live gate is `storage:pg-test`
  (`HASNA_PROMPTS_PG_TEST_DATABASE_URL`).
- `public_manifest_safety` — the signing secret is declared by environment variable name
  (`metadata.service.signingSecretEnvVar: HASNA_PROMPTS_API_SIGNING_KEY`), never as a
  vault path, on a public manifest.

`src/contracts-conformance.test.ts` enforces this file against live conformance output:
the set of failing checks must be empty, the passing checks above must hold, and the
suite goes red if a check regresses.

The former open gates were tracked as todos task `1c1c18f0-072e-4331-a1e8-e8f897427485`
in project `open-prompts` and are closed by this patch.
