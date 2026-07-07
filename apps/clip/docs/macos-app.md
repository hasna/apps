# Open Clip macOS Menu Bar App

Open Clip ships a simple native macOS menu bar app in the same repo as the CLI.
The app is intentionally thin:

- Reads are lightweight status/list actions through the `clip` CLI.
- Mutations always go through `clip capture`, `clip clipboard`, and
  `clip copy-link`.
- The Swift code does not write to SQLite or artifact files directly.

This keeps the CLI and SDK as the source of truth for storage, capture, and
share behavior.

## Layout

```
Package.swift
Sources/ClipCore/       CLI argv builder and process runner
Sources/ClipMenuBar/    AppKit status item and menu actions
Sources/ClipSmoke/      CLI smoke harness for static verification
scripts/build_clip_app.sh
scripts/check_macos_sources.sh
```

## Build On macOS

```bash
bun run check:macos
swift build -c release --product OpenClip
swift run -c release ClipSmoke
bash scripts/build_clip_app.sh
open dist/OpenClip.app
```

The bundle id is `com.hasna.openclip`.

The GitHub Actions macOS app build is compile-only. It runs the source contract
check, compiles the `OpenClip` executable, and runs `ClipSmoke`; it does not
sign, notarize, publish, or upload an app bundle.

## Spark01 Validation

Spark01 is Linux, so it cannot compile AppKit sources. The repo includes a
static check:

```bash
bun run check:macos
```

Run the Swift build on an Apple host before distributing a signed app.
