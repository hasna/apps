# Contract Conformance

Open Feedback ships a `hasna.contract.json` describing itself against the
[Hasna Service Contract v1](https://github.com/hasna/contracts). Run the check
with:

```bash
bun run contract-check    # contracts repo-conformance .
```

**It exits 1 today, and that is the accurate result.** This page records what is
genuinely missing, so the failure is legible instead of mysterious.

## Why the manifest declares no `storage` block

`storage.mode` admits `sqlite` and `postgres` and nothing else. The only
implemented backend in this package is an append-only JSONL file at
`~/.hasna/feedback/feedback.jsonl` (`LocalFeedbackStore` in `src/storage.ts`).
There is no SQLite database and no PostgreSQL driver here; the `cloud` runtime
mode is a seam that requires the host to inject its own `FeedbackStore` adapter,
and `createFeedbackStore` throws without one.

The schema will not let the real store be described even approximately —
`storage.sqlitePath` must match `\.db$`, so it cannot point at `feedback.jsonl`.
So there is no `storage` block that is both schema-valid and true, and the
manifest omits it rather than assert a backend that does not exist. A
`cli-with-store` manifest is required to declare `storage`, which is why
`manifest_valid` is the first reported failure.

Two escape hatches exist and both are closed to this repo, by the kit's own
rules rather than by choice:

- **The PostgreSQL storage waiver is refused.** It is available only to a
  CLI-only `cli-with-store` repo. Measured verdict: *"storage waivers are not
  permitted for a service-capable cli-with-store repo shipping feedback-serve"*.
- **Reclassifying as `library` is refused.** Measured verdict: *"library repos
  must not ship a -serve or -mcp bin"*. This package ships both.

## What is actually required to conform

Each item is real implementation work, not a manifest edit.

1. **Move the store onto a contract storage engine.** SQLite as the local
   default, with a migration for existing `feedback.jsonl` data, and
   `exportJsonl` preserved as an export format rather than the storage format.
2. **Implement PostgreSQL as a second engine**, plus a `storage.pgTestGate`
   naming an env-gated live-PostgreSQL test. This is not optional while
   `feedback-serve` ships: the waiver that would excuse it is unavailable to a
   service-capable repo.
3. **Complete the HTTP service topology**: add `GET /ready` and `GET /version`,
   and reshape `GET /health` to the contract's `{ status, version, mode }`.
   Note that `mode` must report a `sqlite | postgres` backend, so this cannot
   land before step 1 — the API topology and the storage migration are one piece
   of work, not two. Reshaping `/health` is a breaking change to the published
   HTTP surface and needs its own version note.
4. **Publish an OpenAPI document** at `/openapi.json` and generate the
   TypeScript client from it. `FeedbackClient` is hand-written today, so
   `generatedFrom` cannot be declared truthfully until it is generated.
5. **Add a self-host deployment artifact** (`Dockerfile` or `compose.yml`) and
   verify it builds and serves.

Once those land, the API surface can move from `deferred` to `supported` and the
manifest can carry the `storage` block the contract requires.

## What already conforms

The release gate does. `metadata.release.artifactScan.script` names the
`artifact-scan` package script, `prepack` reaches it, and it scans the **packed
tarball** rather than the source tree — see `scripts/scan-artifact.ts`. Scanning
`src/` would report on files that are never published and miss built output that
is, which is a gate that cannot fail for the case it exists to catch.

Because `repo-conformance` returns early when the manifest is invalid, that gate
is not visible in the report today. It was verified by running the check against
a copy of this repo carrying a hypothetical `storage` block; the gate passed, and
the same probe is what caught the declared script name being wrong.

That probe is no longer a one-off — see below.

## The measured gap, and the check that holds it

`bun run contract-check` reports exactly one failure, because `repo-conformance`
stops at `manifest_valid`. **Fixing the manifest does not leave the repo one step
from conformant.** Running the check against a copy carrying the minimal
schema-valid `storage` block shows what the early return hides:

| check | status |
| --- | --- |
| `manifest_valid` | fails today; passes under the probe |
| `surface_matrix` | fail — `missing supported surface declarations or eligible waivers: api` |
| `service_api_topology` | fail — `a supported API surface is required` |
| `surface_bindings` | fail — `generatedFrom is required for a supported service SDK` |
| `self_host_artifact` | fail — no `Dockerfile` / `compose.yml` |
| `storage_capabilities` | fail — `missing storage engines: sqlite, postgres`, plus `envPrefix` and `pgTestGate` |

Everything else passes, including `published_artifact_gate`,
`credential_seam_compliance`, `public_manifest_safety` and `hosting_story`.

Note what ties four of those five together: **they are consequences of shipping
`feedback-serve`.** The PostgreSQL waiver is refused for a service-capable repo,
and the API topology, SDK binding and self-host artifact are all required because
a serve bin is present. They are one decision's worth of work, not five
independent ones, which is why the list above is not a checklist to nibble at.

`bun run contract-gap` pins that set and runs in CI. It fails when a new
violation appears **and** when an existing one is fixed without the baseline
being lowered, so neither drift nor silent progress goes unrecorded. It probes
behind the early return deliberately: a ratchet reading only the reported output
would baseline one failure and pass forever while the other five sat unseen.
