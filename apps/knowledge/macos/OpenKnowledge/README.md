# Open Knowledge macOS

Native SwiftUI app for local and hosted open-knowledge workflows.

```bash
swift run --package-path macos/OpenKnowledge OpenKnowledge
macos/OpenKnowledge/package-app.sh
```

The app uses `auto` command discovery by default and requires either an
installed `knowledge` command or Bun plus a repo/bundled `knowledge.js`.

Native Swift/package verification must be run on macOS with Swift/Xcode. The
Linux validation pass for this feature could not execute those commands because
`swift` and `plutil` were unavailable.

See `docs/macos-app.md` for architecture, local/cloud configuration, and
validation commands.
