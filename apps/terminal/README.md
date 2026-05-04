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
Real installed-CLI gate:                   NOT SUPPORTED
90% weighted target:                       NOT SUPPORTED
99.99% quality target:                    SUPPORTED
```

Latest local real installed-CLI result:

```text
Weighted real installed-CLI token reduction: 9.0%
Quality failures:                            4
Floor failures:                              12
90% real installed-CLI target:               NOT SUPPORTED
```

The honest result is not "90% everywhere." Some synthetic workflows beat 90%: passing test summaries, package-install noise, repeated identical/diff test loops, large repetitive listings, indexed diffs, and huge logs. Real workflows that require the full list of files or matches often lose most savings after expansion is charged, and small outputs can be negative because the wrapper adds status text.

Current pass/fail rule: the synthetic suite must cover every required workflow, preserve critical error markers, keep no-savings scenarios honest, include at least 200 stress scenarios with at least 10 scenarios per required workflow, clear a synthetic 90% weighted token-reduction threshold, and preserve at least 99.99% quality. The final 90% target also requires a real installed-CLI report with both target repos covered, zero quality failures, no workflow/category floor failures, and at least 90% weighted reduction after stdout, stderr, status text, hints, penalties, and full-output expansion costs are counted.

The app gets there through several cheap layers:

- zero-AI compression for ANSI stripping, noise filtering, dedupe, truncation, lazy expansion, smart directory display, and diff caching
- structured MCP tools for `execute_smart`, `execute_diff`, `search_content`, `search_files`, `read_file`, `repo_state`, `token_stats`, and `session_history`
- progressive output expansion so agents can request matching lines, bounded windows, or context around a match instead of reloading the entire command output
- cheap AI routing for terminal summaries, preferring Groq for output processing and Cerebras for open-source model execution when keys are available
- local learned prompt-to-command mappings so repeated agent requests can skip AI entirely
- persistent economy/session stats so agents can measure token savings, cost, and ROI over time

## Cloud Sync

This package supports cloud sync via `@hasna/cloud`:

```bash
cloud setup
cloud sync push --service terminal
cloud sync pull --service terminal
```

## Data Directory

Data is stored in `~/.hasna/terminal/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
