---
"@hasna/prompts": patch
---

feat(prompts): two-backend storage core + markdown body store + authenticated /v1

- Canonical client selection: `HASNA_PROMPTS_API_URL` + `HASNA_PROMPTS_API_KEY`
  select the hosted HTTP API (URL without key fails closed); otherwise local
  SQLite plus a local markdown body folder. A client never opens PostgreSQL.
- Server backend selection: `HASNA_PROMPTS_DATABASE_URL` selects PostgreSQL via
  the vendored storage kit (`src/generated/storage-kit`, MigrationLedger with
  sha256 checksums); absent selects SQLite. No mode enum: the retired
  `HASNA_PROMPTS_STORAGE_MODE`/`PROMPTS_STORAGE_MODE` and
  `PROMPTS_REGISTRY_*` variables are rejected fail-loudly.
- Immutable markdown body objects at `prompts/<id>/versions/<version>.md`
  (local folder or S3), object-first writes, verified reads (SHA-256 + byte
  count, named failures), `prompt_bodies` registry, additive `body_*` columns.
- `prompts storage status | migrate --dry-run | reconcile` verbs; migrate
  requires a dry-run receipt and aborts when counts/hashes no longer agree.
- Contentless FTS5 index fed at write time (SQLite) and tsvector + GIN
  (PostgreSQL); the legacy body-trigger FTS is retained until the verified
  cutover.
- Authenticated, tenant-scoped `/v1` API with `GET /health`, `GET /ready`,
  `GET /version`, `GET /openapi.json`; wildcard CORS removed (legacy `/api`
  is explicitly local-only). API keys via `@hasna/contracts/auth`.
- Explicit `./sdk` export with `createPromptsClient()` selecting local or
  HTTP; generated client from `openapi.json`.
- Conformance gates closed: `surface_matrix`, `service_api_topology`,
  `self_host_artifact`, `storage_capabilities`; `contracts:check` exits 0.
