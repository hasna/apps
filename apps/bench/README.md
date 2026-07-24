# @hasna/bench

CLI, SDK, and MCP foundation for an open-source benchmark aggregator and wrapper for AI model, coding, agent, RAG, safety, latency, and multimodal benchmark suites.

`bench` starts with a versioned 13-suite seed benchmark registry, manifest validation, local storage initialization, CLI, SDK, and MCP entrypoints. It discovers benchmark suites through explicit manifests, plans safe execution without running third-party code, records normalized local results, and compares model/provider runs.

It complements `@hasna/evals`: evals scores app behavior; bench orchestrates external benchmark harnesses and their evidence.

## What It Does

- Lists benchmark suites with source, license, runner, metric, adapter, and safety metadata.
- Validates legacy `bench.manifest.v1` benchmark manifests.
- Returns dry-run adapter plans for external suites without executing benchmark code.
- Records manual benchmark results and fixture-safe wrapper payloads into local SQLite plus append-only JSONL evidence.
- Emits canonical `@hasna/contracts` JSON additively with `--contract --json` for dry-run plans, recorded runs, fixture runs, and result details.
- Redacts raw credential-shaped values before persistence and rejects unsafe model/provider/metric/artifact metadata.
- Enforces fail-closed fixture gates for secret refs, required network, sandbox requirements, high-cost budgets, token limits, and runtime limits.
- Exposes the same core capabilities through CLI, SDK, and MCP tools.

## Current Limits

- Built-in adapters are dry-run/manual-record only; real external benchmark execution is intentionally not enabled yet.
- The seed registry is bundled at package build time. User registry ingestion and remote discovery crawlers are planned but not yet implemented.
- Large artifact upload is represented by local artifact metadata. Future integrations should move large blobs to `@hasna/files` or another artifact store.
- MCP tools inspect registry/results and validate in-request manifest objects; they do not execute local benchmark files.

## Install

```bash
bun install -g @hasna/bench
```

## Quick Start

Commands that call `doctor`, `runs record`, or `runs fixture` create local SQLite/JSONL state. By default that state is under `~/.hasna/bench`. Use an isolated store when trying the package:

```bash
export HASNA_BENCH_HOME="$(mktemp -d)"
export HASNA_BENCH_DB_PATH="$HASNA_BENCH_HOME/bench.db"

bench suites list
bench suites show lm-evaluation-harness --json
bench suites list --json
bench plan lm-evaluation-harness --model example/model --provider example-provider --json
bench results list --json
bench report --json
bench doctor --json
bench-mcp --help
```

From a repo checkout, you can also use the bundled fixtures:

```bash
bench manifest validate examples/benchmark.valid.json --json
bench runs record lm-evaluation-harness --model example/model --provider example-provider --input examples/result-record.json --json
bench runs fixture lm-evaluation-harness --model example/model --provider example-provider --input examples/result-record.json --network --json
bench plan lm-evaluation-harness --model example/model --provider example-provider --json --contract
bench results show <run-id> --json --contract
```

`--contract --json` is additive: the response includes both `legacy` bench output and canonical `contracts` output validated through `@hasna/contracts`. The canonical contract evidence refs use portable `artifact://bench/...` URIs. The `legacy` object preserves existing bench JSON and may include local storage paths such as result segment files, so share the `contracts` object when a portable or machine-neutral payload is needed. The local `bench.manifest.v1` and `bench.evidence.v1` envelopes are still supported, but they are legacy bench-owned shapes pending the namespace decision that `hasna.*` schema ids are minted only by `@hasna/contracts`.

## Discovery Model

Open-bench discovery is manifest-first. A benchmark becomes runnable only after it has:

- a stable suite id and immutable manifest version
- upstream source references and verification date
- license and attribution metadata
- runner capabilities, expected artifacts, and declared metrics
- safety metadata for network, sandbox, secret, and cost behavior
- an adapter with dry-run command planning and parser expectations

See [docs/discovery.md](docs/discovery.md) for how candidate benchmarks are found and promoted.

## Data Directory

Local data is stored under `~/.hasna/bench/`.

Use `HASNA_BENCH_HOME` or `HASNA_BENCH_DB_PATH` to isolate test stores.

## Current Status

This package slice provides the scaffold, v1 manifest schema, seed registry metadata, adapter dry-run plan registry, fixture-safe local wrapper execution, manifest validation, local result recording, result inspection/comparison/reporting, CLI, SDK, MCP tools, local storage directory initialization, and safety/evidence gates. Real external benchmark execution is not implemented in this release; current controls apply to planning, fixture-safe recording, manual result recording, and evidence.

`--network` is an explicit policy acknowledgement for fixture metadata. It does not make open-bench perform outbound benchmark execution.

## Documentation

- [Architecture](docs/architecture.md)
- [Results format](docs/results-format.md)
- [Discovery workflow](docs/discovery.md)
- [Adapter authoring](docs/adapter-authoring.md)
- [Agent handoff](docs/agent-handoff.md)
- [Security](SECURITY.md)

## License

Apache-2.0.
