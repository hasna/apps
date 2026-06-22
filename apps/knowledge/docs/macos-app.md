# Open Knowledge macOS App

The native macOS app lives in `macos/OpenKnowledge`. It is a SwiftUI shell over
the existing `knowledge` CLI and hosted API contracts.

## Architecture

- Local mode uses the configured `knowledge` executable as the source of truth.
  The app runs JSON commands such as `paths`, `inventory`, `storage status`,
  `db stats`, `search`, `ask`, `ingest`, `reindex`, `sync`, `providers`, and
  `auth`.
- Cloud mode uses the existing hosted contract from `src/remote-client.ts` for
  hosted `search` and `ask` requests. API keys are read from `KNOWLEDGE_API_KEY`,
  `HASNA_KNOWLEDGE_API_KEY`, or the existing auth file reported by
  `knowledge auth whoami --json`.
- Durable local writes still go through `knowledge` commands. The app never
  writes directly to `.hasna/apps/knowledge`.
- The visual system follows the available open-codewith source cues: native
  split-view navigation, compact status affordances, settings/account sections,
  and the Codewith emerald accent `rgb(5,150,105)`.

## Run From Source

On macOS with Swift 5.9+:

```bash
swift run --package-path macos/OpenKnowledge OpenKnowledge
```

The app defaults to `auto` command discovery. It checks for a bundled
`knowledge.js`, a repo-local `bin/knowledge.js` in the selected workspace, then
an installed `knowledge` executable. Finder-launched apps get an expanded PATH
including `~/.bun/bin`, `/opt/homebrew/bin`, and `/usr/local/bin`.

Change the command path in Settings if you need an explicit binary, for example
`/opt/homebrew/bin/knowledge`, `~/.bun/bin/knowledge`, or a repo-local
`bin/knowledge.js`. Running `knowledge.js` requires Bun.

## Build An App Bundle

```bash
macos/OpenKnowledge/package-app.sh
open "macos/OpenKnowledge/dist/Open Knowledge.app"
```

The bundle registers the `openknowledge://workspace?path=/absolute/path`
deep-link scheme. A future CLI launcher can mirror the open-codewith pattern by
opening this URL with the desired project workspace.

If `bin/knowledge.js` exists when packaging runs, the script copies it into the
app bundle as `Contents/Resources/knowledge.js`. The bundled helper still
requires Bun on the target Mac; the app does not vendor a Bun runtime.

## Local Functionality

The app supports:

- Dashboard/status for paths, storage, DB stats, sync, validation, providers,
  auth, reindex, embeddings, and wiki lint.
- Sources inventory and previews.
- Local hybrid search and citation-backed ask/build context.
- Compatibility note creation through `knowledge add`.
- Source and manifest ingestion.
- Reindex queueing and deterministic fake embedding refresh for smoke tests.
- Sync status, snapshot creation, and local peer dry-run.
- Local/hosted setup and hosted login/logout through the CLI.

## Cloud Functionality

Configure hosted mode:

```bash
knowledge setup --mode hosted --api-url https://knowledge.hasna.xyz --scope project --json
knowledge auth login --api-key <key> --scope project --json
knowledge remote status --scope project --json
```

Cloud search/ask requires hosted credentials and a service that implements:

- `POST /api/v1/knowledge/search`
- `POST /api/v1/knowledge/ask`

The request and run result shapes match `src/remote-client.ts`. If credentials
are absent, Auto mode falls back to local operations.

## Validation

Cross-platform bridge tests:

```bash
bun test tests/app-bridge.test.ts
```

macOS app checks:

These native checks must be run on a Mac with Swift/Xcode installed. They were
not executed during the Linux implementation pass because `swift` and `plutil`
were not available on that host.

```bash
swift build --package-path macos/OpenKnowledge -c release --product OpenKnowledge
macos/OpenKnowledge/package-app.sh
plutil -lint "macos/OpenKnowledge/dist/Open Knowledge.app/Contents/Info.plist"
```

After any knowledge state changes, validate the project storage boundary:

```bash
knowledge storage validate --strict --scope project --json
```
