# Agent Handoff

Use this file when another agent picks up open-bench work.

## Current Capabilities

- CLI binary: `bench`
- MCP binary: `bench-mcp`
- package: `@hasna/bench`
- local data: `~/.hasna/bench`
- built-in suites: 13 seed benchmark manifests
- execution status: dry-run plans, manual result recording, and fixture-safe local wrapper recording only

## Safe Smoke Commands

These commands should not require secrets. `doctor`, `runs record`, and `runs fixture` create local state, so isolate the store before smoke testing:

```bash
export HASNA_BENCH_HOME="$(mktemp -d)"
export HASNA_BENCH_DB_PATH="$HASNA_BENCH_HOME/bench.db"

bench suites list --json
bench suites show lm-evaluation-harness --json
bench manifest validate examples/benchmark.valid.json --json
bench plan lm-evaluation-harness --model example/model --provider example-provider --json
bench runs record lm-evaluation-harness --model example/model --provider example-provider --input examples/result-record.json --json
bench results list --json
bench report --json
bench doctor --json
bench-mcp --help
```

Fixture runs that model remote-provider behavior must acknowledge policy with environment variable names:

```bash
bench runs fixture promptfoo --model example/model --provider example-provider --metric score=0.9 --secret-ref OPENAI_API_KEY --network --json
```

`--network` is only an evidence-policy acknowledgement in this release. It does not execute an external benchmark harness.

## Validation

Before release or handoff:

```bash
bun install
bun run typecheck
bun test
bun run build
bun run pack:check
```

Before commit or push, run the mandatory staged-files secret scan from the workspace instructions.

## Release Notes

- Do not claim real benchmark execution until an isolated runner exists.
- Do not bypass adversarial reviews for safety, docs, publish, or install tasks.
- Preserve unrelated user changes in the worktree.
