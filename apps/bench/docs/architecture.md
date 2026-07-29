# Architecture

`open-bench` is being built as an orchestration layer around benchmark suites. It does not replace benchmark harnesses or `@hasna/evals`.

## Boundaries

- Benchmark suites own their domain-specific tasks and metrics.
- `@hasna/bench` currently owns v1 registry manifests, source/license/safety metadata, CLI/SDK/MCP surfaces, manifest validation, local storage initialization, dry-run plans, result normalization, local evidence, comparison, and safety gates.
- `@hasna/evals` owns assertion and judge-based app evaluation.
- `@hasna/gateway` should own model/provider routing and usage normalization.
- `@hasna/files` and `@hasna/logs` should own large artifacts and append-only event segments when integrated.

## Local Storage

Default root: `~/.hasna/bench`.

Current layout:

```text
~/.hasna/bench/
  bench.db
  runs/
    <run-id>/
      results.jsonl
  artifacts/
```

SQLite stores searchable projections and evidence indexes. Raw benchmark output events are append-only JSONL records under `runs/<run-id>/results.jsonl`, with SQLite keeping byte offsets, byte lengths, and per-record SHA-256 hashes.

Storage hardening rules:

- SQLite opens with foreign keys and a 5s busy timeout.
- Seed manifest versions are immutable: same `benchmark_id` plus `manifest_version` cannot change hash.
- Attempt-scoped rows must reference an attempt from the same run.
- Concurrent appends to one run segment are serialized in-process so byte offsets remain contiguous.
- One raw result segment record is capped at 1 MiB by default; large raw outputs should be stored as artifacts.
- Artifact paths are normalized and must remain inside the bench store.

Current tables:

- `registries`
- `benchmarks`
- `benchmark_versions`
- `runs`
- `attempts`
- `result_segments`
- `metrics`
- `artifacts`
- `provider_usage`

## Registry Manifest

Every built-in suite is parsed through legacy `bench.manifest.v1` at package load. A manifest records:

- immutable `manifestVersion`
- verified source references
- license metadata and attribution requirements
- runner kind and capabilities
- metrics with score direction
- adapter status
- safety class, network, sandbox, secret, and cost metadata

`bench.manifest.v1` remains supported for current CLI, SDK, MCP, and fixture compatibility. Canonical `hasna.*` contract shapes are emitted additively through `@hasna/contracts`; `bench.manifest.v1` maps lossy into `hasna.validation_plan.v1` because the canonical plan records checks and evidence requirements, not the full benchmark registry manifest. This is the convergence path for the namespace decision that `hasna.*` schema ids are minted only by `@hasna/contracts`.

## Adapters

Adapters are declarative in this slice. Each adapter records install metadata, supported execution modes, a safe sample command, expected outputs, parse mode, safety metadata, and the metrics it can project. `bench plan` and the MCP tool `bench_plan` return those dry-run plans without executing external code. Every bundled manifest currently has `adapter.status: planned`, while the adapter objects advertise `dry-run` and `manual-record` execution modes.

Adapter execution modes:

- `dry-run`: returns a command plan and expected artifacts; never executes external code.
- `manual-record`: records caller-supplied metrics and evidence.
- `external-runner`: reserved for a later implementation with isolated sandboxes.

## Safety And Evidence

Fixture-safe recording fails closed unless license metadata is explicit and the caller satisfies the benchmark's safety metadata. Secret-bearing benchmarks accept only secret reference names such as `OPENAI_API_KEY`, never raw credential values. Network and sandbox acknowledgements plus high-cost, token, and runtime limits are carried as explicit fixture policy. Manual `runs record` persists supplied results but does not apply the fixture safety gate.

Fixture-safe runs do not execute external benchmark code. They normalize caller-supplied metric payloads, redact sensitive evidence fields before append-only storage, persist a legacy `bench.evidence.v1` manifest, and index each segment by offset, length, and SHA-256.

Contract adapters under `src/lib/contract-adapters.ts` expose canonical `hasna.work_run.v1`, `hasna.cost_estimate.v1`, `hasna.evidence_ref.v1`, `hasna.proof_bundle.v1`, and `hasna.validation_plan.v1` JSON at the CLI boundary. The adapters validate drafts with `parseContract` and keep legacy storage/output behavior unchanged unless `--contract --json` is requested.

Low-level storage helpers also protect evidence:

- result segment payloads are redacted before JSONL persistence
- run, metric, artifact, and provider-usage metadata reject raw credential-shaped values
- provider usage values must be finite and non-negative

## MCP Boundary

`bench-mcp` exposes registry, validation, planning, result inspection, comparison, report, and doctor tools over stdio. The MCP server validates manifest objects supplied in the request. It intentionally does not read arbitrary local manifest paths, record results, emit additive contract bundles, or run benchmark commands.
