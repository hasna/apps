# Local Editor And IDE Integrations

`@hasna/todos` integrates with editors through the public local CLI and MCP
contracts. These recipes do not import private modules, call hosted services, or
depend on `platform-todos`.

## VS Code

Copy the task definitions from `examples/editor-integrations/vscode/tasks.json`
into `.vscode/tasks.json`. They show up through `Tasks: Run Task` in the command
palette and cover:

- `todos: ready` for the next local queue
- `todos: active` for in-progress work
- `todos: extract source TODOs` for gitignore-aware source indexing
- `todos: context pack` for local agent handoff context

The commands only invoke `todos ... --json` and can be used by Codex, Claude
Code, Takumi, or any terminal task runner.

## JetBrains

Use the external tool recipes in
`examples/editor-integrations/jetbrains-external-tools.md`. Set the program to
`todos`, the working directory to `$ProjectFileDir$`, and keep arguments on the
documented CLI surface such as `ready --json`, `extract $ProjectFileDir$ --dry-run
--index --json`, or `context-pack $Prompt$ --format markdown`.

## Neovim

`examples/editor-integrations/neovim/todos.lua` exposes lightweight Lua helpers
for:

- filling quickfix with `todos ready --json`
- showing current status with `todos status --json`
- extracting source TODOs with `todos extract ... --json`

The example uses `vim.system` and parses JSON returned by the CLI, so it stays
compatible with remote terminals and local-only workspaces.

## Statusline And Task Picker

`examples/editor-integrations/statusline.sh` prints a compact local queue
summary suitable for tmux, shell prompts, or editor statuslines.

`examples/editor-integrations/task-picker.ts` is a Bun script that reads
`todos ready --json` and prints a deterministic picker list without importing
package internals.

## File Links

Source and editor workflows should link files through public commands:

```bash
todos extract . --dry-run --index --json
todos blame src/index.ts
todos context-pack <task-id> --files 20 --format markdown
```

Tasks created by source extraction include `task_files` links and source
metadata such as `source_file`, `source_line`, `source_symbol`, and
`source_fingerprint`. Editors can display those fields directly from CLI JSON or
MCP tool results.
