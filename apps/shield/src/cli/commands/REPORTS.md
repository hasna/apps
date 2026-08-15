# Agent triage reports

## Exposure report

```sh
shield exposure-report --workspace . --history --github-alerts --redact --json
shield exposure-report --workspace . --history --redact --markdown
```

The report scans workspace files and, with `--history`, local git history. Findings are deterministically sorted and contain only `kind`, `location`, and `maskedExcerpt`; raw matched values are never emitted. `--redact` documents the invariant and cannot disable masking. In offline environments, requested `--github-alerts` are reported as `unavailable` without failing the command.

`--markdown` selects Markdown output; otherwise output is JSON (`--json` makes that choice explicit).

## Supply-chain report

```sh
shield supply-chain report --since 24h --json
shield supply-chain report --workspace ./service --since 7d --json
```

The report recursively reads supported npm-family lockfiles without registry or network access, sorts dependency records, lists local git lockfile changes in the `--since` lookback, and matches exact locked versions against Shield's bundled advisories. Supported duration suffixes are `m`, `h`, `d`, and `w`.
