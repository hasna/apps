# CLI reference

The `statusline` binary reads and updates the same configuration used by the
renderer. Run `statusline help`, `statusline --help`, or `statusline -h` for the
top-level summary. Run `statusline version`, `statusline --version`, or
`statusline -v` to print the package version.

## Rendering

```bash
statusline render
```

`render` reads a Claude Code status payload as JSON from stdin and prints the
configured status rows. It is also the default command when no arguments are
provided. Empty input, invalid JSON, and unreadable stdin are treated as an
empty payload rather than an error. Segments with unavailable data, unknown
configured segment ids, and segments that throw are omitted.

## Discovering segments

```bash
statusline list [options] [search text]
statusline search <text> [options]
statusline show <segment> [--json]
statusline inspect <segment> [--json]
```

`list` prints enabled segments first in human-readable output and shows at most
12 matching rows by default. A positional search string and `--search` values
are combined into one case-insensitive query over segment ids and descriptions.

| Option | Short | Behavior |
|--------|-------|----------|
| `--all` | | Show every matching row. |
| `--enabled` | | Show only enabled segments. |
| `--disabled` | | Show only disabled segments. |
| `--json` | `-j` | Print structured JSON. Without `--limit`, JSON includes every match. |
| `--limit <n>` | | Show at most a positive integer number of rows. |
| `--search <query>` | `-s` | Filter by id or description. |
| `--verbose` | | Include descriptions in human-readable output. |
| `--help` | `-h` | Print list help. |

`--enabled` and `--disabled` cannot be combined. `--all` and `--limit` cannot be
combined. JSON output has this shape:

```json
{
  "total": 26,
  "matching": 26,
  "showing": 26,
  "limited": false,
  "segments": [
    {
      "id": "machine",
      "description": "Machine hostname (short)",
      "defaultEnabled": true,
      "enabled": true
    }
  ],
  "next": null
}
```

When results are limited, `next` is `{ "all": true, "limit": <matching> }`.
`search` is an alias for `list --search`; it accepts `--all`, `--enabled`,
`--disabled`, `--json`/`-j`, `--limit`, and `--verbose`. `show` and its `inspect`
alias print one segment's id, current state, default state, description, and
related commands. Their `--json`/`-j` output is the segment object alone.

## Updating configuration

```bash
statusline enable <segment...>
statusline disable <segment...>
statusline order <segment...>
statusline separator <text...>
statusline colors <on|off>
statusline reset
```

- `enable` validates every id and appends newly enabled segments to the current
  order. Already enabled ids stay in place.
- `disable` validates every id and removes matching ids from the current order.
- `order` requires at least one known id and replaces both the exact order and
  the enabled set. Duplicate ids are accepted and render more than once.
- `separator` joins all arguments with spaces and requires a non-empty value.
- `colors` stores a boolean. `NO_COLOR` still disables ANSI output at render
  time even when colors are configured on.
- `reset` writes `defaultConfig()` to the resolved config path.

Unknown segment errors include a `statusline list` discovery hint. Successful
mutations print the new value or segment order.

## Preview

```bash
statusline preview
```

`preview` renders the current configuration with a built-in Claude payload and
the process's current directory. Segments that depend on real session files or
environment state can still be omitted.

## Claude Code installation

```bash
statusline install
statusline install claude
```

`claude` is the default and only supported target. The command writes a
`statusLine` command entry to the settings file selected for the current
process:

1. `$CLAUDE_CONFIG_DIR/settings.json` when `CLAUDE_CONFIG_DIR` is non-blank;
2. otherwise `$HOME/.claude/settings.json` (or the operating-system home when
   `$HOME` is unset).

A leading `~/` in `CLAUDE_CONFIG_DIR` is expanded against `$HOME`. Existing
settings and existing `statusLine` keys are preserved, and the previous file is
copied to `settings.json.bak-statusline`. Invalid existing JSON is rejected.
Only the default `~/.claude` directory is created automatically; an explicit or
isolated target directory must already exist.

The installed command uses the absolute path returned by `Bun.which("statusline")`
when available and otherwise uses `statusline render`.

## Exit behavior

Successful commands exit with status 0. Unknown commands print top-level help
and set status 1. Invalid arguments, unknown options, unsupported install
targets, unknown segments, and failed writes print a concise message to stderr
and set status 1.

See [Configuration and rendering](configuration.md) for config-path precedence
and renderer behavior.
