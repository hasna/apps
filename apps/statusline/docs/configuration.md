# Configuration and rendering

Statusline stores a small JSON document containing the separator, ordered
enabled-segment list, and color preference.

## Config path

The config path is resolved in this order:

1. an explicit path passed to `configPath(path)`, `loadConfig(path)`, or
   `saveConfig(config, path)`;
2. `$STATUSLINE_CONFIG` when it is non-empty;
3. `$XDG_CONFIG_HOME/statusline/config.json` when `XDG_CONFIG_HOME` is non-empty;
4. otherwise `~/.config/statusline/config.json`.

The CLI uses this resolved path for reads and writes. Parent directories are
created when saving.

## Schema and defaults

```json
{
  "separator": " · ",
  "colors": true,
  "segments": [
    "machine",
    "project",
    "commit-age",
    "loc",
    "model-context",
    "context-remaining",
    "cost"
  ]
}
```

- `separator` is inserted between rendered segments in the same row.
- `colors` enables ANSI styling requested by individual segments. It defaults to
  `true`; any non-empty `NO_COLOR` environment value overrides it at render time.
- `segments` is both the enabled set and the render order. `newline` starts a
  new output row.

When the file is missing, unreadable, or invalid JSON, `loadConfig()` returns all
defaults. For valid JSON, each property falls back independently: `separator`
must be a string, `colors` must be a boolean, and `segments` must be an array.
Non-string array entries are discarded. Loading does not reject unknown or
duplicate segment ids.

CLI and SDK update helpers validate segment ids before writing. The renderer is
more defensive: an unknown configured id is skipped, and a duplicate id renders
that segment again.

## Rendering rules

`renderLine(context, config)` visits configured ids in order:

1. `newline` starts a new row.
2. Unknown ids are ignored.
3. Known segments render with the supplied `StatusContext`.
4. A segment returning `null` or an empty string is omitted.
5. A segment that throws is omitted; it never fails the statusline.
6. Non-empty segments in a row are joined with `separator`.
7. Empty rows are removed, and remaining rows are joined with `\n`.

Colors wrap only the text emitted by a segment, not separators. Currently
`model-with-reasoning` is cyan, `fast-mode` and rate limits below 80% are yellow,
`auth-profile` and `auth-email` are magenta, `thread-title` is blue, and rate
limits at or above 80% are red. Segments without a color declaration remain
plain.

## Context-window data

`context-used`, `context-remaining`, and `used-tokens` read the transcript named
by `transcriptPath`. The transcript is scanned from the end for the latest JSONL
entry whose `message.usage.input_tokens` is numeric. Input-side usage is:

```text
input_tokens + cache_creation_input_tokens + cache_read_input_tokens
```

Missing cache fields count as zero. `used-tokens` also adds the latest
`output_tokens`. The assumed window is 1,000,000 tokens when the model id
contains `[1m]`, and 200,000 otherwise. Missing, unreadable, malformed, or
usage-free transcripts cause these segments to render nothing.

## Environment-dependent segments

- `fast-mode` reads `settings.json` from the session config directory and emits
  `fast` only when its `fastMode` value is exactly `true`.
- `auth-profile` and `auth-email` resolve identity from the process's own
  `CLAUDE_CONFIG_DIR`, never from a global active-profile pointer.
- With no `CLAUDE_CONFIG_DIR`, the session config directory is `~/.claude`, but
  Claude's login record is searched in the home directory as `~/.config.json`
  first and then a known `.claude<oauth-variant>.json` file.
- Account registry paths use the optional `@hasna/accounts/storage` module when
  available. Otherwise `ACCOUNTS_STORE_PATH`, `ACCOUNTS_HOME`, and finally
  `~/.hasna/accounts` provide the fallback locations.

See the complete segment catalog in the [README](../README.md#segments) and the
mutation commands in the [CLI reference](cli.md#updating-configuration).
