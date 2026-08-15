# Results Format

Local results are split between SQLite projections and append-only JSONL events. A run stores its benchmark and immutable manifest version, model/provider/route metadata, status, labels, and timestamps. Related tables store attempts, metrics, provider usage, artifact metadata, and result-segment indexes.

`bench runs record` creates one completed run and attempt, records declared metrics and optional provider usage, and appends one redacted event. The event type defaults to `manual-record` but can be supplied through the SDK. `bench runs fixture` creates the same run/attempt projections, records normalized declared metrics and a provider-usage marker, and appends both `fixture-result` and `evidence-manifest` events.

Large raw outputs should live outside SQLite. SQLite stores metadata, indexes, hashes, and artifact pointers.

Raw segment records are append-only JSONL. Each indexed segment stores the byte offset, byte length, and SHA-256 of the exact JSONL line. A single segment event is capped at 1 MiB by default so oversized raw output is forced into artifact storage instead of SQLite-indexed event payloads.

Fixture-safe wrapper runs write two evidence events: a redacted `fixture-result` event and a legacy `bench.evidence.v1` manifest. Callers pass environment variable names with repeatable `--secret-ref`; values that are not environment-variable names or look like raw secrets fail the fixture safety gate.

`bench.evidence.v1` is a bench-owned legacy envelope. Canonical `@hasna/contracts` output is available additively from `bench plan`, `bench runs record`, `bench runs fixture`, and `bench results show` when both `--contract` and `--json` are present. Result mappings can include `hasna.evidence_ref.v1`, `hasna.proof_bundle.v1`, `hasna.work_run.v1`, and `hasna.cost_estimate.v1`; plan mappings emit `hasna.validation_plan.v1`. A cost estimate is emitted only when provider usage includes `costUsd`. Contract evidence URIs use `artifact://bench/...` identifiers instead of machine-specific local paths. In the same additive response, `legacy` preserves the existing bench result JSON and can still include local segment paths; use `contracts` for portable evidence references.

`bench.evidence.v1` includes:

- run, attempt, benchmark, manifest, model, and provider ids
- stable metric and redacted payload hashes
- manifest, source, and adapter command hashes
- package version
- explicit policy acknowledgements for `secretRefs`, network, sandbox, and limits
- safety gate result
- artifact manifest entries
- cleanup status
- redaction findings

The evidence manifest stores safe environment variable names, such as `OPENAI_API_KEY`, but never raw credential values.

`bench.manifest.v1` maps lossy into `hasna.validation_plan.v1`: source, license, runner, adapter, and safety metadata are summarized as validation checks and required evidence kinds. The full legacy manifest remains the source for `bench manifest validate` until the namespace convergence decision removes or replaces bench-owned schema ids.
