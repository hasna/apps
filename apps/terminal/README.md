# @hasna/terminal

Smart terminal wrapper for AI agents and humans — structured output, token compression, MCP server, natural language.

`@hasna/terminal` is a token economy layer for coding agents. It keeps full terminal output expandable on demand, but returns compact, structured answers for the routine loops that burn context: tests, builds, searches, git state, process management, file discovery, and repeated command runs.

[![npm](https://img.shields.io/npm/v/@hasna/terminal)](https://www.npmjs.com/package/@hasna/terminal)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/terminal
```

## CLI Usage

```bash
terminal --help
```

Useful agent commands:

```bash
terminal install
terminal stats
terminal sessions stats
terminal discover --days=30
bun run benchmark
bun run benchmark:real || true
bun benchmarks/benchmark.mjs --variant=baseline
bun benchmarks/benchmark.mjs --variant=progressive
bun benchmarks/benchmark.mjs --compare
```

## Token Reduction

The benchmark is intentionally adversarial. It treats the old optimistic 90% result as invalid and measures the ways token savings break down: AI input/output overhead, Groq/Cerebras provider cost, provider rate limits, retries, cache misses, full-output expansion, summary quality traps, small outputs, and already-compact output.

```bash
bun run build
bun test
bun run benchmark
bun run benchmark:real || true
bun benchmarks/real-cli-benchmark.mjs --output=.benchmark-artifacts/real-cli-benchmark.json || true
bun benchmarks/benchmark.mjs --real-cli-report=.benchmark-artifacts/real-cli-benchmark.json
```

There are now two gates:

- the synthetic adversarial suite, which is useful for stress-testing scenarios and implementation assumptions
- the real installed-CLI suite, which runs equivalent raw shell workflows against the actual `terminal` binary in `open-terminal` and `iapp-logos`

The official 90% claim requires both gates. Synthetic results alone are not enough.

Latest local synthetic result, comparing the old baseline with the progressive disclosure and indexed variants:

```text
Baseline adversarial token reduction:     56.4%
Progressive token reduction:              93.6% (quality failures remain)
Indexed token reduction:                  98.0%
Indexed cost reduction:                   98.0%
Indexed quality rate:                     100.0%
Stress scenarios:                         320
Minimum scenarios per workflow:           17
Synthetic 90% target:                      SUPPORTED
Real installed-CLI gate:                   SUPPORTED
90% weighted target:                       SUPPORTED
99.99% quality target:                    SUPPORTED
```

Latest local real installed-CLI result:

```text
Weighted real installed-CLI token reduction: 92.3%
Weighted lossless-audit token reduction:     9.0%
Quality failures:                            0
Workflow/category floor failures:            0
90% real installed-CLI target:               SUPPORTED
```

The honest result is not "90% everywhere." The supported 90% claim is for task-required evidence: the first answer plus any compact evidence packet the task actually needs. File/test inventory prompts now return a small typed inventory and a manifest/raw-ref instead of charging exact-path enumeration up front. The benchmark still reports a separate lossless-audit line showing what happens if every full raw output is loaded anyway; that is intentionally not the 90% claim. Tiny outputs use a bounded-overhead floor because percentage savings on a 4-token success result are not meaningful, but those tokens still count in the weighted total.

Current pass/fail rule: the synthetic suite must cover every required workflow, preserve critical error markers, keep no-savings scenarios honest, include at least 200 stress scenarios with at least 10 scenarios per required workflow, clear a synthetic 90% weighted token-reduction threshold, and preserve at least 99.99% quality. The final 90% target also requires a real installed-CLI report with both target repos covered, zero quality failures, no workflow/category floor failures, and at least 90% weighted reduction after stdout, stderr, status text, hints, penalties, and task-required evidence costs are counted. Lossless raw-output expansion is tracked separately as an audit metric.

The app gets there through several cheap layers:

- zero-AI compression for ANSI stripping, noise filtering, dedupe, truncation, lazy expansion, smart directory display, and diff caching
- structured MCP tools for `execute_smart`, `execute_diff`, `search_content`, `search_files`, `read_file`, `repo_state`, `token_stats`, and `session_history`
- progressive output expansion so agents can request matching lines, bounded windows, or context around a match instead of reloading the entire command output
- cheap AI routing for terminal summaries, preferring Groq for output processing and Cerebras for open-source model execution when keys are available
- local learned prompt-to-command mappings so repeated agent requests can skip AI entirely
- persistent economy/session stats so agents can measure token savings, cost, and ROI over time

## Storage

Terminal stores session data locally under the Hasna data directory and includes repo-owned PostgreSQL migrations for remote storage deployments.

```bash
terminal storage status --json
HASNA_TERMINAL_DATABASE_URL=postgres://... terminal storage push --tables sessions,interactions --json
terminal storage pull --json
terminal storage sync --json
```

Canonical production storage uses database `terminal` on RDS cluster
`hasna-xyz-infra-apps-prod-postgres`. Runtime credentials are stored in AWS
Secrets Manager at `hasna/xyz/opensource/terminal/prod/rds`; load its
`database_url` value into `HASNA_TERMINAL_DATABASE_URL`. The legacy fallback
`TERMINAL_DATABASE_URL` is still accepted during cutover and rollback windows.

Optional storage mode env vars are `HASNA_TERMINAL_STORAGE_MODE` or
`TERMINAL_STORAGE_MODE` with `local`, `hybrid`, or `remote`. `local` keeps data
in SQLite only, `hybrid` syncs local SQLite with PostgreSQL, and `remote` is
reserved for deployments that should require the canonical PostgreSQL target.

## Data Directory

Data is stored in `~/.hasna/terminal/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
