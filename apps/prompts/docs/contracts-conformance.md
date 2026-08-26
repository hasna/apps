# Contracts conformance status

`hasna.contract.json` declares this repo against `hasna.service_contract.v1`. The gate is
`bun run contracts:check` (`@hasna/contracts@0.13.4 repo-conformance .`).

**Validator-version note (measured 2026-08-26):** the CI census
(`tooling/ci/check-manifests.ts`) validates this repo at the pinned
`@hasna/contracts@0.14.0`, and the latest published kit is `0.14.1`. All three kits —
`0.13.4`, `0.14.0`, `0.14.1` — fail the identical four checks listed below, so the
register is invariant across the app's own gate, the CI gate, and latest.

**`bun run contracts:check` currently exits 1.** Four checks are open. They are recorded
here rather than papered over, because the manifest is only allowed to describe surfaces
that actually exist — declaring `api` and `sdk` as `supported`, or `postgres` as a storage
engine, would make the manifest false while making the script green.

`src/contracts-conformance.test.ts` enforces this file against live conformance output: the
set of failing checks must equal the table below, and every other check must pass or skip.
The suite goes red if a passing check regresses, if a listed gate closes, or if this
register drifts from reality.

## Open conformance gates

| Check | Why it is open |
| --- | --- |
| `surface_matrix` | The `api` and `sdk` surfaces are declared `deferred`, not `supported`. `prompts-serve` exposes 11 unversioned `/api/*` routes and `GET /health`; the `.` export is a hand-written library, not a client generated from an OpenAPI document. |
| `service_api_topology` | No API surface is `supported`, and none can be until `prompts-serve` gains the `/v1` base path plus `GET /health`, `GET /ready`, and `GET /version`. |
| `self_host_artifact` | The repo ships no `Dockerfile` or compose file. The artifact is deliberately deferred with the service surface it would deploy. |
| `storage_capabilities` | `storage.engines` and `storage.pgTestGate` are undeclared because `src/db/database.ts` is SQLite-only. A live-PostgreSQL gate cannot be declared without a PostgreSQL engine behind it. |

Tracked as todos task `1c1c18f0-072e-4331-a1e8-e8f897427485` in project `prompts`.

## Why no waiver closes them

The kit derives all four from one fact: `prompts-serve` is a declared bin. In
`@hasna/contracts@0.13.4` (`dist/conformance.js`), a `cli-with-store` repo whose bins include
`<name>-serve` sets `requiresGeneratedServiceSdk`, which

- promotes `requiredSurfaceKinds` from `['cli']` to all four surface kinds, so `deferred` is
  not enough for `api` or `sdk`;
- leaves `eligibleWaiverKinds` empty — surface waivers exist only for `class: "library"` or
  `waiverProfile: "non-node-monorepo"`, neither of which applies here;
- requires a self-host deployment artifact; and
- makes a storage waiver explicitly ineligible: *"storage waivers are not permitted for a
  service-capable cli-with-store repo shipping prompts-serve."*

## The two routes to green

Mutually exclusive, and both are owner decisions rather than incremental cleanups.

1. **Implement the service.** Add the `/v1` base path, `GET /health`, `GET /ready`, and
   `GET /version`, publish an OpenAPI document, ship a generated TypeScript SDK on its own
   export subpath, add a `Dockerfile` or compose file, and add a PostgreSQL storage engine
   with a live `storage.pgTestGate`.
2. **Drop the `prompts-serve` bin.** `requiredSurfaceKinds` collapses to `['cli']` and
   storage waivers become eligible, so the remaining gates close with a manifest change.
   Removing a bin from the published `@hasna/prompts` is a breaking change.

## Checks that pass today

`manifest_valid`, `bins_allowlisted`, `bins_match_package`, `surface_bindings`,
`public_manifest_safety`, `hosting_story`, `server_backend_configuration`,
`published_artifact_gate`, `credential_seam_compliance`, `no_cloud_guard`.
`mode_enum_compliance` no longer exists in the 0.13.4 kit (the mode vocabulary was
removed); the manifest now declares `storage.backend`. `health_shape` skips because
no `GET /health` sample is handed to the checker.
