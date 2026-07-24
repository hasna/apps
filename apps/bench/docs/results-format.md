# Results Format

The first result format will normalize external benchmark outputs into stable records:

- suite id, schema version, and immutable manifest version
- run id and attempt id
- model/provider/route metadata
- metrics and score values
- latency, token, and cost fields when available
- artifact references and checksums
- safety/license/sandbox/source metadata
- evidence manifests with redacted fixture payload hashes and safety gate results
- parser warnings and raw-output pointers

Large raw outputs should live outside SQLite. SQLite stores metadata, indexes, hashes, and artifact pointers.

Raw segment records are append-only JSONL. Each indexed segment stores the byte offset, byte length, and SHA-256 of the exact JSONL line. A single segment event is capped at 1 MiB by default so oversized raw output is forced into artifact storage instead of SQLite-indexed event payloads.

Fixture-safe wrapper runs write two evidence events: a redacted `fixture-result` event and a legacy `bench.evidence.v1` manifest. Credential values are never accepted on the command line; callers pass environment variable names with `--secret-ref`.

`bench.evidence.v1` is a bench-owned legacy envelope. Canonical `@hasna/contracts` output is available additively with `--contract --json`, which maps result segments and legacy evidence into `hasna.evidence_ref.v1`, `hasna.proof_bundle.v1`, `hasna.work_run.v1`, and `hasna.cost_estimate.v1`. Contract evidence URIs use `artifact://bench/...` identifiers instead of machine-specific local paths. In the same additive response, `legacy` preserves the existing bench result JSON and can still include local segment paths; use `contracts` for portable evidence references.

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
