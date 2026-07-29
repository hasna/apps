# Open Clip macOS Menu Bar App

Open Clip includes a thin native menu bar app in the same repository as the
CLI. The app does not open SQLite or write artifact files. Every action starts
the `clip` CLI, which remains the storage and mutation boundary.

## Actions

| Menu item | CLI command |
| --- | --- |
| Capture Full Screen | `clip capture full --copy-link` |
| Capture Window | `clip capture window --copy-link` |
| Capture Region | `clip capture region --copy-link` |
| Share Clipboard | `clip clipboard --copy-link` |
| Open Recent | `clip open-recent` |
| Quit | Terminates the menu bar app. |

The menu key equivalents are `1`, `2`, `3`, `c`, `o`, and `q`, respectively.
CLI work runs off the main app thread. Failures are written to the macOS system
log; the current app does not display an in-app error dialog.

## CLI Resolution

The app bundle does not contain the `clip` executable. Install or build the CLI
separately. At runtime the app resolves it in this order:

1. Executable path from `HASNA_CLIP_CLI`
2. `~/.bun/bin/clip`
3. `~/.local/bin/clip`
4. `/opt/homebrew/bin/clip`
5. `/usr/local/bin/clip`
6. `clip` through `/usr/bin/env`

`HASNA_CLIP_CLI` is used only when it points to an executable file.

## Layout

```text
Package.swift
Sources/ClipCore/       CLI argument builder, executable resolution, and runner
Sources/ClipMenuBar/    AppKit status item and menu actions
Sources/ClipSmoke/      Static command-construction smoke harness
scripts/build_clip_app.sh
scripts/check_macos_sources.sh
```

## Build on macOS

Prerequisites:

- macOS 13 or newer
- Swift 5.9 or newer
- Bun 1.3 or newer for the source check
- A built or installed `clip` CLI for runtime menu actions

Compile and smoke-check the Swift package:

```bash
bun run check:macos
swift build -c release --product OpenClip
swift run -c release ClipSmoke
```

Create an unsigned local app bundle:

```bash
bash scripts/build_clip_app.sh
open dist/OpenClip.app
```

The bundle identifier is `com.hasna.openclip`.

The GitHub Actions macOS job runs the source contract check, compiles
`OpenClip`, and runs `ClipSmoke`. It does not sign, notarize, publish, or upload
an app bundle.

## Validation on Non-macOS Hosts

AppKit cannot be compiled on Linux or Windows. The repository still provides a
static source contract check:

```bash
bun run check:macos
```

Run the Swift build and the actual menu actions on a macOS host before
distributing an app bundle.
