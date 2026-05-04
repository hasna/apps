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
```

## Token Reduction

The benchmark is intentionally adversarial. It treats the old optimistic 90% result as invalid and measures the ways token savings break down: AI input/output overhead, Groq/Cerebras provider cost, provider rate limits, retries, cache misses, full-output expansion, summary quality traps, small outputs, and already-compact output.

```bash
bun run build
bun test
bun run benchmark
```

Latest local result:

```text
Weighted raw billable tokens:       1,121,590
Weighted optimized billable tokens:   562,605
Weighted net tokens saved:            558,985
Weighted token reduction:              49.8%
Weighted cost reduction:               54.0%
90% all-coding-workflows claim:        NOT SUPPORTED
```

The honest result is not "90% everywhere." Some workflows beat 90%: passing test summaries, package-install noise, repeated identical/diff test loops, and large repetitive listings. Other workflows are weak or negative: full diffs before commit, security/detail review, command retries, cold-cache starts, and cases where the agent must expand full output.

Current pass/fail rule: the suite must cover every required workflow, preserve critical error markers, and clear a 45% weighted token-reduction threshold. The threshold is deliberately below 90% because the suite includes workflows where compression should not claim savings.

The app gets there through several cheap layers:

- zero-AI compression for ANSI stripping, noise filtering, dedupe, truncation, lazy expansion, smart directory display, and diff caching
- structured MCP tools for `execute_smart`, `execute_diff`, `search_content`, `search_files`, `read_file`, `repo_state`, `token_stats`, and `session_history`
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
