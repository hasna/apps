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
```

Latest local result, comparing the old baseline with the progressive disclosure and indexed variants:

```text
Baseline adversarial token reduction:     56.4%
Progressive token reduction:              93.6% (quality failures remain)
Indexed token reduction:                  98.0%
Indexed cost reduction:                   98.0%
Indexed quality rate:                     100.0%
Stress scenarios:                         320
Minimum scenarios per workflow:           17
90% weighted adversarial target:          SUPPORTED
99.99% quality target:                    SUPPORTED
```

The honest result is not "90% everywhere." Some workflows beat 90%: passing test summaries, package-install noise, repeated identical/diff test loops, large repetitive listings, paged search results, indexed diffs, and huge logs. Other workflows are intentionally weaker or zero-savings: small outputs, already-compact output, and short retry outputs where there is not much token budget to save.

Current pass/fail rule: the suite must cover every required workflow, preserve critical error markers, keep no-savings scenarios honest, include at least 200 stress scenarios with at least 10 scenarios per required workflow, clear a 90% weighted token-reduction threshold, and preserve at least 99.99% quality. The indexed variant reaches that by returning summaries/handles first, then charging only realistic follow-up expansion through deterministic manifests and `grep`, `offset`, `limit`, and `context` windows when details are needed.

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
