# Service Contract Conformance Status

Shield tracks the Hasna Service Contract v1 published by `@hasna/contracts`. The
declaration lives in [`hasna.contract.json`](../hasna.contract.json), which is
shipped inside the published tarball (`package.json` → `files`), so it is read by
consumers and tooling, not just by CI.

## Gates

| Command | What it checks | Enforced |
| --- | --- | --- |
| `bun run contracts:manifest` | `hasna.contract.json` is a valid `hasna.service_contract.v1` manifest | Yes — CI step, plus `src/contract-manifest.test.ts` in the test suite |
| `bun run contracts:check` | Full repo self-check (`contracts repo-conformance .`) | Not yet — see the open gates below |

Both scripts resolve the `contracts` binary from the pinned
`@hasna/contracts` devDependency, so the gate is reproducible from the lockfile
rather than from whatever version a package runner resolves at run time.

## Declared surfaces

`shield` is a `cli-with-store` repo: a CLI over a package-owned local SQLite
store at `~/.hasna/security/shield.db`, plus an MCP server and a REST/dashboard
server. That is the path `getDbPath()` resolves and the path `postinstall`
creates; `~/.hasna/shield/shield.db` is a legacy location shield migrates *from*
and never writes to, so it must not be declared as the store.

- `cli` — supported (`shield`)
- `mcp` — supported (`shield-mcp`)
- `sdk` — supported (`./sdk` export, `@hasna/shield-sdk`)
- `api` — **deferred**. `shield-serve` answers `/api/*` on localhost but does not
  serve the contract topology (`GET /health`, `GET /ready`, `GET /version`) and
  publishes no OpenAPI document.

## Open gates

`bun run contracts:check` currently exits non-zero. These are real capability
gaps, not manifest defects, and each needs product work rather than a metadata
edit. They are recorded here rather than papered over with a waiver, because a
`cli-with-store` repo that ships `<name>-serve` is not eligible for either a
storage-engine waiver (`WAIVABLE_STORAGE_ENGINES` excludes `sqlite`, and the
serve bin disqualifies the `postgres` waiver) or a service-surface waiver
(library-only). A waiver declared here would be silently ignored by conformance
while reading like an approved exception.

| Check | Gap | What closes it |
| --- | --- | --- |
| `storage_capabilities` | Shield has no PostgreSQL backend. `src/db` is `bun:sqlite` throughout, and `resolveStorageMode()` rejects every non-local mode. `src/db/pg-migrations.ts` holds translated DDL but nothing executes it. | Implement the PostgreSQL engine behind the existing db layer, then declare `storage.engines` and `storage.pgTestGate` (a live-PG proof command). |
| `surface_matrix`, `service_api_topology` | No `GET /health`, `GET /ready`, or `GET /version` on `shield-serve`, so the API surface cannot be declared `supported`. | Serve the three contract endpoints, then promote the `shield-api` surface to `supported`. |
| `self_host_artifact` | No `Dockerfile` or compose file for `shield-serve`. | Add one self-host deployment artifact. |
| `surface_bindings` | The SDK is hand-written (`sdk/src/client.ts`), so `generatedFrom` cannot honestly point at an OpenAPI document. | Publish an OpenAPI document from `shield-serve` and generate the SDK client from it. |

Until those land, `contracts:check` is the honest status report and
`contracts:manifest` is the enforced gate.
