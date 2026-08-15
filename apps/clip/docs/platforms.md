# Platform Support

Open Clip detects local tools at runtime. `clip status` reports the detailed
capability object; `clip doctor` adds a top-level `ok` result.

## Screenshot Capture

| Platform | Full screen | Window | Region | Active-window metadata |
| --- | --- | --- | --- | --- |
| macOS | `screencapture` | `screencapture -w` | interactive `screencapture -i` | `osascript` |
| Linux | `gnome-screenshot`, then `grim`, then `scrot` | `gnome-screenshot -w` | interactive `gnome-screenshot -a` | `xdotool` |
| Windows | Windows PowerShell virtual-screen capture | Not supported | Not supported | Not supported |

Linux capture requires `DISPLAY` or `WAYLAND_DISPLAY` in addition to a capture
binary. `grim` and `scrot` are used only for full-screen capture; window and
region modes require `gnome-screenshot`.

Windows capture looks for `powershell.exe`, `powershell`, `pwsh.exe`, or
`pwsh`. It captures the Windows virtual-screen bounds as PNG. There is no
Windows window-selection, region-selection, or active-window implementation.

All modes are best-effort. If a mode is unavailable, the command exits with an
error and directs the operator to `clip doctor`.

## Screenshot Annotations

Capture annotations run locally after the platform tool produces a screenshot
and before the artifact is imported into the Clip store.

Supported operations are `crop`, `box`, `blur`, and `arrow` objects, applied in
the order provided, as described in the [CLI reference](cli.md#capture). The
annotator accepts non-interlaced, 8-bit PNGs with grayscale, RGB,
grayscale-alpha, or RGBA color. Unsupported bit depths, color types,
compression/filter methods, interlacing, invalid colors, and out-of-bounds
regions fail explicitly.

## Clipboard Read

For `--kind auto`, Open Clip tries content in this order:

1. File
2. Image
3. Text

| Platform | Text | Image | File |
| --- | --- | --- | --- |
| macOS | `pbpaste` | `pngpaste` | No native file capability is advertised; an existing path in text can still be recognized. |
| Linux | `wl-paste`, then `xclip` | `wl-paste`, then `xclip` | `wl-paste` with `text/uri-list`; only this backend is advertised as file-capable. |
| Windows | Windows PowerShell | Windows PowerShell | Windows PowerShell file-drop list |

Empty or unavailable content falls through to the next kind in `auto` mode. An
explicit unavailable kind returns an error instead.

Clipboard history is opt-in. `clip clipboard` creates a share directly and
does not add a history item; only `clip history capture` writes to the history
store.

## Clipboard Write

The standalone `clip copy-link` command and the `--copy-link` flags on
`capture`, `clipboard`, and `history share` use:

- macOS: `pbcopy`
- Linux: `wl-copy`, then `xclip`
- Windows: Windows PowerShell `Set-Clipboard`, with a Windows Forms fallback

A standalone `clip copy-link` failure is reported in its command result without
setting a nonzero process exit status. The three creation-path `--copy-link`
flags are best-effort: their commands discard the copy result, so copy failure
is silent and does not change the successful creation result.

## Opening Local Targets

`clip open` and `clip open-recent` prefer an existing local artifact and
otherwise use the generated share URL.

- macOS uses `open`.
- Linux uses `xdg-open`, then `gio open`.
- Windows local opening is not implemented.

An opener failure is reported in the result. It does not change the share or
artifact.

## Headless and Remote Sessions

The CLI, SDK, HTTP server, and MCP server act in the session of their own
process. A remote or service process may have access to SQLite while lacking a
display server, desktop clipboard, or opener. In particular:

- Linux screenshot capture is unavailable without `DISPLAY` or
  `WAYLAND_DISPLAY`.
- Clipboard tools may target a different or unavailable desktop session.
- HTTP and MCP capture/clipboard calls operate on the server host, not the
  calling client's desktop.

Use `clip doctor --json` in the same runtime environment as the long-running
process to verify its actual capabilities.
