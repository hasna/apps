# Open Clip CLI

The `clip` CLI reads and writes the local SQLite and artifact store. It never
requires a hosted service.

## Global Options

Global options may be placed before or after a subcommand.

| Option | Behavior |
| --- | --- |
| `--json` | Emit compact JSON instead of formatted text. |
| `--home <path>` | Override the local data and config directory. |
| `--db <path>` | Override the SQLite database path. |
| `--artifact-dir <path>` | Override the managed artifact directory. |
| `--base-url <url>` | Override the base used to generate share URLs. |
| `--host <host>` | Override the server/share host. |
| `--port <port>` | Override the server/share port. |
| `-V`, `--version` | Print the package version. |
| `-h`, `--help` | Print help. Use `clip <command> --help` for command options. |

## Commands

### Capture

```text
clip capture [full|window|region]
  --title <title>
  --copy-link
  --annotation <json>
  --crop <x,y,width,height>
  --box <x,y,width,height>
  --blur <x,y,width,height>
  --arrow <x1,y1,x2,y2>
  --contract [evidence|resources|all]
```

The mode defaults to `full`. Annotation flags are repeatable and are applied in
argument order. The shorthand rectangle/arrow flags use pixel coordinates.
`--annotation` accepts one JSON operation or an array:

```bash
clip capture region \
  --crop 40,20,1200,700 \
  --box 80,60,300,120 \
  --blur 500,100,240,80 \
  --arrow 100,500,420,300

clip capture full \
  --annotation '{"type":"box","x":20,"y":20,"width":240,"height":100,"color":"#ff3b30","lineWidth":4}'
```

Supported JSON operations are:

- `crop`: `x`, `y`, `width`, `height`
- `box`: rectangle fields plus optional `color` and `lineWidth`
- `blur`: rectangle fields plus optional `radius`
- `arrow`: `from: {x,y}`, `to: {x,y}`, plus optional `color` and `lineWidth`

Annotations require the captured image to be a supported, non-interlaced,
8-bit grayscale, RGB, grayscale-alpha, or RGBA PNG.

### Clipboard

```text
clip clipboard
  --kind <auto|text|image|file>
  --title <title>
  --copy-link
  --contract [evidence|resources|all]
```

The kind defaults to `auto`, which tries file, image, then text content using
the local platform tools.

### Clipboard History

Clipboard history is opt-in: normal `clip clipboard` calls do not add history
items.

```text
clip history [--limit <n>]
clip history list [--limit <n>]
clip history capture
  [--kind <auto|text|image|file>]
  [--title <title>]
  [--max-items <n>]
clip history share <id-or-slug> [--title <title>] [--copy-link]
clip history reshare <id-or-slug> [--title <title>] [--copy-link]
```

List limits and the capture retention limit default to `25`. List limits are
normalized to `1` through `500`; history retention is normalized to `1` through
`100`. Sharing a history item creates a normal share without changing the
history record.

### Explicit Shares

```text
clip share text <text...>
  [--title <title>]
  [--ttl <duration> | --expires-at <timestamp>]
  [--contract [evidence|resources|all]]

clip share file <path>
  [--title <title>]
  [--ttl <duration> | --expires-at <timestamp>]
  [--contract [evidence|resources|all]]
```

TTL values are positive integer durations with optional `s`, `m`, `h`, `d`, or
`w` units; no unit means seconds. Examples include `30s`, `10m`, `2h`, `7d`,
and `1w`. `--expires-at` accepts a date or ISO timestamp. The two expiry
options are mutually exclusive.

Expired shares remain in the store until pruning. They are excluded from normal
lookup and listing after their expiry time.

### Read, Delete, and Open

```text
clip list [--limit <n>] [--deleted] [--contract [evidence|resources|all]]
clip show <id-or-slug> [--qr] [--contract [evidence|resources|all]]
clip delete <id-or-slug>
clip open <id-or-slug>
clip open-recent
clip copy-link <id-or-slug> [--qr]
```

`list` defaults to `25` active rows and normalizes its limit to `1` through
`500`. `--deleted` includes soft-deleted and expired rows. `show --qr` and
`copy-link --qr` render the share URL as a terminal QR code when ordinary text
output is active. With `--json`, `copy-link` returns its normal JSON result and
`show` returns the record.

`delete` is a soft delete. `open` prefers an existing local artifact and
otherwise opens the share URL. `open-recent` uses the newest non-deleted,
non-expired share.

### Prune and Uninstall

```text
clip prune
clip prune --apply
clip uninstall --yes
```

`clip prune` is a dry-run preview. `--apply` soft-deletes expired shares and
removes their managed artifacts inside the configured artifact directory. Its
orphan scan considers only generated, UUID-named artifact files. Artifacts
outside the managed directory are not removed.

`clip uninstall` refuses to run without `--yes`. It removes the configured
database, managed artifacts, and config only when they are inside the Clip home
directory. It refuses filesystem-root, user-home, whole-`~/.hasna`, and
out-of-home purge targets.

### Server, Config, and Diagnostics

```text
clip serve
  [--host <host>]
  [--port <port>]
  [--base-url <url>]
  [--auth-token <token>]

clip config list
clip config get [key]
clip config set <key> <value>
clip status
clip doctor
```

`serve` defaults to `127.0.0.1:3741`. See
[HTTP API reference](http-api.md) before exposing it beyond localhost.

The known config keys are `baseUrl`, `host`, and `port`; `port` must be an
integer from `1` through `65535`. Other keys are preserved as JSON string
values.

`status` reports storage counts, the generated base URL, capture modes, active
window context, and clipboard support. `doctor` adds an `ok` field that is true
when full-screen capture or clipboard text/image capture is available.

## JSON and Contract Output

`--json` is a global option and emits compact JSON from commands that produce
output.

The `--contract` option is available on `capture`, `clipboard`, `share text`,
`share file`, `list`, and `show`. It emits contract JSON instead of normal
record output regardless of `--json`:

- `--contract` or `--contract evidence`: one evidence reference per record.
- `--contract resources`: resource references for local artifacts and share
  URLs.
- `--contract all`: an object containing both the evidence reference and
  resource references.

Human-readable command failures print `Error: <message>` to stderr and exit
with status `1`. With `--json`, failures print `{"error":"<message>"}` to
stdout and still exit with status `1`.

`open`, `open-recent`, and the standalone `copy-link` command are exceptions
when the local opener or copy tool itself fails: they return a result
describing the tool failure without changing the share and without setting a
nonzero process exit status.

The `--copy-link` flags on `capture`, `clipboard`, and `history share` are
best-effort. Those creation commands discard the copy result, so a copy-tool
failure is not reported and does not set a nonzero process exit status.

## Platform Backends

- macOS screenshots use `screencapture`; active-window metadata uses
  `osascript`; clipboard text/image uses `pbpaste` and `pngpaste` when present.
- Linux full-screen capture uses `gnome-screenshot`, `grim`, or `scrot`.
  Window/region capture requires `gnome-screenshot`, and active-window metadata
  requires `xdotool`. Clipboard operations use `wl-paste`, `wl-copy`, or
  `xclip`.
- Windows full-screen capture and text/image/file clipboard operations use
  `powershell.exe` or `pwsh`. Window/region capture and active-window detection
  are not implemented.

Display-dependent Linux screenshot support also requires `DISPLAY` or
`WAYLAND_DISPLAY`.
