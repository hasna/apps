# CLI Reference

```text
prompts [options] <command>
```

Global options must appear before the command:

| Option | Behavior |
| --- | --- |
| `--json` | Emit JSON instead of human-readable output. |
| `--project <name>` | Scope supported operations by project name, slug, or ID. |
| `-V, --version` | Print the package version. |
| `-h, --help` | Print help. |

Run `prompts <command> --help` for Commander-generated help for a command.

## Prompt Commands

| Command | Important options | Behavior |
| --- | --- | --- |
| `save <title>` | `--body`, `--file`, `--slug`, `--description`, `--collection`, `--tags`, `--source`, `--agent`, `--force`, `--pin` | Create a prompt or update the prompt selected by slug. A missing body, or `--body -`, reads stdin. |
| `use <id>` | `--edit` | Print the body and increment usage; optionally edit it first. |
| `get <id>` | `--verbose` | Show details without incrementing usage. `show` is an alias. Human output includes the full body only with `--verbose`. |
| `body <id>` | — | Print only the body without incrementing usage. |
| `list` | `--collection`, `--tags`, `--templates`, `--recent`, `--limit`, `--offset`, `--cursor`, `--verbose` | List prompts. Defaults: 20 human records or 50 JSON records. |
| `search <query>` | `--collection`, `--tags`, `--limit`, `--offset`, `--cursor`, `--verbose` | Search with SQLite FTS5 and a `LIKE` fallback. Defaults: 10 human or 20 JSON results. |
| `render <id>` | `--var <key=value...>` | Increment usage and fill `{{name}}` and `{{name|default}}` variables. Missing required variables remain unresolved and produce a warning in human mode. |
| `templates` | `--collection`, `--limit`, `--offset`, `--cursor`, `--verbose` | List template prompts. Defaults: 20 human or 50 JSON records. |
| `inspect <id>` | — | Show detected template variables, defaults, and required state. |
| `update <id>` | `--title`, `--body`, `--description`, `--collection`, `--tags`, `--agent` | Patch prompt fields and record body versions. |
| `edit <id>` | `--agent` | Open frontmatter and body in `$EDITOR`. |
| `delete <id>` | `--yes` | Delete a prompt after confirmation. |
| `remove <id>` | `--yes` | Delete alias; also available as `rm` and `uninstall`. |
| `copy <id>` | — | Copy the body to the platform clipboard and increment usage. |
| `share <id>` | `--clipboard` | Export one prompt as Markdown to stdout or the clipboard. |
| `similar <id>` | `--limit`, `--verbose` | Rank by tag overlap and collection, falling back to collection when no tags exist. |
| `duplicate <id>` | `--to`, `--title` | Clone a prompt with a new slug. |
| `pin <id>` / `unpin <id>` | — | Change whether a prompt sorts first. |
| `expire <id> [date]` | — | Set an ISO expiry date; omit the date or use `none` to clear it. |
| `chain <id> [next]` | — | Show a prompt chain, set the next prompt, or clear it with `none`. |

An `<id>` can be a full ID, unique ID prefix, slug, unique slug prefix, or a
unique title/slug substring.

## Version and Quality Commands

| Command | Important options | Behavior |
| --- | --- | --- |
| `history <id>` | — | List stored prompt versions. |
| `restore <id> <version>` | `--agent` | Restore an older body as a new current version. |
| `diff <id> <v1> [v2]` | — | Diff two versions; `v2` defaults to the current body. |
| `validate <id>` | repeatable `--var`, `--vars <json>` | Run lint checks and optionally validate a simulated render. |
| `lint` | `--collection`, `--limit`, `--verbose` | Check descriptions, variables, body length, tags, and organization. Exits nonzero when any error exists, including beyond the displayed page. |
| `audit` | — | Check orphaned projects, empty collections, missing history, near-duplicate slugs, and expiry. |
| `stats` | — | Show registry usage statistics. |
| `storage` | — | Show read-only local/remote storage diagnostics without revealing configured values. |
| `recent [n]` | `--offset`, `--cursor`, `--verbose` | Show recently used prompts; `n` defaults to 10. |
| `stale [days]` | `--limit`, `--offset`, `--cursor`, `--verbose` | Show prompts unused for the lookback; days defaults to 30. |
| `unused` | `--collection`, `--limit`, `--offset`, `--cursor`, `--verbose` | Show prompts with `use_count = 0`. Defaults: 20 human or 50 JSON records. |
| `trending` | `--days`, `--limit` | Show most-used prompts in a lookback window; defaults to 7 days and 10 results. |

## Organization and Bulk Commands

| Command | Important options | Behavior |
| --- | --- | --- |
| `collections` | `--limit`, `--offset`, `--cursor` | List collections; human output defaults to 20. |
| `move <id> <collection>` | — | Move one prompt, creating the collection if needed. |
| `tag <id>` | `--add`, `--remove`, `--set` | Patch or replace comma-separated tags. |
| `bulk-move <collection> [ids...]` | `--yes` | Move IDs supplied as arguments or newline-delimited stdin. |
| `bulk-tag [args...]` | — | Apply `+tag`/`-tag` operations to argument or stdin IDs. |
| `bulk-delete [ids...]` | `--yes` | Delete argument or stdin IDs. `bulk-rm` is an alias. |

## Projects

| Command | Important options | Behavior |
| --- | --- | --- |
| `project create <name>` | `--description`, `--path` | Create a project. |
| `project list` | `--limit`, `--offset`, `--cursor` | List projects; human output defaults to 20. |
| `project get <id>` | — | Show one project. |
| `project prompts <id>` | `--limit`, `--offset`, `--cursor`, `--verbose` | List project-scoped prompts plus global prompts. |
| `project delete <id>` | `--yes` | Delete a project; its prompts become global. |

`--project` affects supported top-level operations such as save, list, search,
templates, recent, trending, stale, and unused. Global prompts remain visible in
project-scoped lists.

## Schedules

Cron expressions use five fields: minute, hour, day of month, month, weekday.

| Command | Important options | Behavior |
| --- | --- | --- |
| `schedule add <id> <cron>` | `--vars <json>`, `--agent` | Schedule a prompt and calculate its next run. |
| `schedule list [id]` | `--limit`, `--offset`, `--cursor` | List all schedules or filter by prompt ID. |
| `schedule remove <scheduleId>` | — | Delete a schedule. `schedule delete` is an alias. |
| `schedule due` | `--dry-run` | Render due schedules. Note: current storage code advances run state while collecting due schedules, including when `--dry-run` is passed. |
| `schedule next <cron>` | `--count` | Preview upcoming runs; defaults to five. |

## Import, Export, and Automation

| Command | Important options | Behavior |
| --- | --- | --- |
| `export` | `--collection`, `--output` | Export full prompt records as JSON. |
| `import <file>` | `--agent` | Import a JSON array or an object with a `prompts` array. Existing slugs are updated. |
| `watch [dir]` | `--collection`, `--agent` | Watch Markdown files (default `.prompts/`) and import changes. Deleted files tag the matching prompt `watch-deleted` instead of deleting it. |
| `import-slash-commands` | `--dir`, `--agent`, `--limit` | Scan `.claude/commands`, `.codex/skills`, and `.gemini/extensions`. |
| `completion [shell]` | — | Print Bash or Zsh completion; defaults from `$SHELL`, otherwise Bash. |

## Agent Config Files

`config` supports `claude`, `agents`, `gemini`, `codex`, `cursor`, and `aider`.
Commands use project-local paths by default and global home paths with
`--global`.

| Command | Important options | Behavior |
| --- | --- | --- |
| `config list` | — | List known local and global config paths. |
| `config get <agent>` | `--global` | Print a config file. |
| `config edit <agent>` | `--global` | Create/open a config in `$EDITOR`. |
| `config inject <slug> <agent>` | `--global`, `--section`, `--replace` | Inject a prompt body, optionally under or replacing a Markdown section. |
| `config set <agent>` | `--global`, `--body`, `--yes` | Write `--body` or stdin, confirming before overwrite. |
| `config scan [workspace]` | `--depth`, `--agents`, `--missing-only`, `--limit`, `--offset`, `--cursor` | Scan Git repositories for present/missing configs. |

The CLI also registers integration commands supplied by its pinned
`@hasna/events` dependency. Because those commands are owned by that package,
use `prompts --help` for their installed-version help.
