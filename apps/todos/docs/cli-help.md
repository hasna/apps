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

## Route-dependent command list (0.16.0)

`--help`, `manual` and the completions are generated from the same Commander
tree, and that tree is filtered by the resolved route:

| Posture | `--help` root commands | `manual --json` `commands` | `completions zsh` lines |
| --- | --- | --- | --- |
| default (hosted surface) | 75 | 121 | 24 |
| `HASNA_TODOS_LOCAL=1` / `TODOS_LOCAL=1` | 166 | 413 | 71 |

The three columns count different things (root commands, the manual's nested
catalog, completion script lines), so compare each column with itself, not
across columns.

0.15.52 advertised all 166 to every caller because the local fallback was
implicit. 0.16.0 advertises only the commands the resolved route exposes,
because the on-box families fail closed without the local opt-in. No
command was removed: every verb still resolves once its posture is configured,
and the curation mechanism (`applyTodosCliHelpVisibility`) is unchanged from
0.15.52 — only its trigger moved with the removal of the implicit local
fallback. Use `HASNA_TODOS_LOCAL=1 todos --help` (or `todos manual --json`) to
enumerate the on-box families. The same opt-in is ignored when
`HASNA_TODOS_API_KEY` or `HASNA_TODOS_API_URL` is set, because a configured
environment outranks it.

## Manual

```bash
todos manual
todos manual --json
```

The manual includes install and update instructions, examples, JSON output
contracts, error behavior, and the generated command catalog. JSON mode is
intended for docs automation and smoke tests that keep help text and completion
output aligned with the CLI.

## project-rename

Rename a project slug. Cascades to matching task lists. Task prefixes (e.g.
APP-00001) are unchanged.

Options: `--name <name>` (also update the project display name), `-j` /
`--json` (output as JSON).

```bash
todos project-rename my-project new-slug --name "New Name"
```

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
