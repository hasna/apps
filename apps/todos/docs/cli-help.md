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
