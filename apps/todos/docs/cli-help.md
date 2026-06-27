# CLI Help and Completions

`@hasna/todos` ships generated shell completions and a local manual from the
same Commander command tree used by `todos --help`.

## Install

```bash
bun install -g @hasna/todos
```

## Update

```bash
bun install -g @hasna/todos
todos upgrade
```

## Completions

```bash
todos completions bash > ~/.local/share/bash-completion/completions/todos
todos completions zsh > ~/.zsh/completions/_todos
todos completions fish > ~/.config/fish/completions/todos.fish
```

The completion scripts include root commands, common nested commands, and
global options such as `--project`, `--json`, `--agent`, and `--session`.

## Manual

```bash
todos manual
todos manual --json
```

The manual includes install and update instructions, examples, JSON output
contracts, error behavior, and the generated command catalog. JSON mode is
intended for docs automation and smoke tests that keep help text and completion
output aligned with the CLI.

## Deterministic Task Upsert

Deterministic loops can create or refresh the same task by stable fingerprint:

```bash
todos --json task upsert \
  --fingerprint "loop:expectation:project:key" \
  --title "Expectation failed" \
  --description "Loop observed a mismatch" \
  --priority high \
  --tags loop,expectation \
  --metadata-json '{"expectation_id":"exp-1"}' \
  --evidence-paths "logs/loop.txt" \
  --origin-loop-id "loop-1" \
  --origin-run-id "run-1" \
  --expected '{"status":"ok"}' \
  --observed '{"status":"failed"}'
```

The fingerprint is stored as `metadata.fingerprint`. Existing tasks are updated
in place and metadata is shallow-merged, so expectation fields such as
`expectation_id`, `expectation_fingerprint`, `evidence_paths`,
`origin_loop_id`, `origin_run_id`, `expected`, `observed`, and `acceptance` can
be refreshed without dropping unrelated task metadata.
