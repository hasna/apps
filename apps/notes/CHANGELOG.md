# @hasna/notes

## 0.4.2

### Patch Changes

- Switch @hasna/notes local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The client data root and the server default SQLite path now resolve from the effective data root: an exact-app override (`HASNA_NOTES_HOME`, then `HASNA_NOTES_ROOT`, then `NOTES_HOME`) wins unconditionally; otherwise the resolver data home (`~/.local/share/hasna/notes` on Linux) is adopted only when the operator sets `HASNA_DATA_HOME` or the store has already been physically migrated there — the legacy `~/.hasna/notes` root stays effective until then, so an existing local store never becomes invisible on upgrade. The one-time copy-forward migrations from the legacy nested roots are unchanged. `@hasna/paths` is pinned exactly to `0.1.0` — the wave-wide pin for the hasna/apps resolver-switch lanes (XDG home migration, hotfixes plan 0f49f56a, task P3.3).

## 0.4.1

### Patch Changes

- 8b70821: notes-serve answers --version/-V before any bind, and notes-mcp answers --version/-V/--help before the stdio framing loop (todos row 7e5f8f3d). Previously `notes-serve --version` bound :8788 with no output, and `notes-mcp --version`/`--help` printed nothing (silent-empty family).
- 98aefc27: Remove an internal hostname reference from a test comment.

## 0.4.0

### Minor Changes

- 6c09087: **BREAKING: the macOS desktop app is removed from `@hasna/notes` and now lives in `hasna-products/personalnotes`.** Owner directive 2026-08-22: this package ships headless only — a local-first notes CLI, an MCP server, an importable SDK, and a self-hosted HTTP server (SQLite or PostgreSQL).

  Removed: the SwiftPM manifest (`Package.swift`), the native WKWebView shell and store library (`Sources/HasnaNotesApp`, `Sources/HasnaNotesCore`, `Sources/HasnaNotesSmoke`), the bundled browser UI (`web/`), the AI sidecar server (`ai-sidecar/`), the brand and app-icon assets (`assets/`), the app build and deploy scripts, and the app-only tooling and docs that existed to serve them. `test/app-removal.test.mjs` guards every removed path against reintroduction. The final upstream commits carrying the app in this repo are **da9764f4 (#638)** and **5a449b417**; the removal landed as **20804a7ce (#934)**.

  **No published surface changed.** The `bin` entries (`notes`, `notes-mcp`, `notes-serve`), the `exports` map (`.`, `./sdk`, `./events`), and the `files` array are byte-identical, so the npm payload is unchanged. Voice capture, realtime transcription, and the chat UI were app surfaces and moved with the app; the `--sidecar <url>` title client remains and now points at any endpoint exposing `POST /title` (this package ships the client, not the server). Two manifest edits were required and are not payload changes: `"ai-sidecar"` dropped from this package's `workspaces` and from `apps/notes/ai-sidecar` in the monorepo root `package.json` — without them `bun install` fails with `Workspace not found "ai-sidecar"`.

  Interoperability is unchanged: the `personalnotes/v1` wire dialect and the Markdown-with-YAML-frontmatter on-disk format remain the shared contract between this package and the desktop app.

  Bump level is `minor`, not `major`, per this repository's demonstrated convention for a pre-1.0 breaking change to this exact package: `notes-sync-removal` (removal of the whole multi-machine sync surface) and `notes-two-backend-storage` (which states "Breaking for downstream consumers" in its own body) both shipped as `minor` and landed together in 0.3.0. `major` here would declare 1.0.0, which is a product statement this gate-healing change is not authorized to make.

## Unreleased

### Minor Changes

- **BREAKING: the macOS desktop app is removed from `@hasna/notes` and now lives in
  `hasna-products/personalnotes` (repo `hasna-products/personalnotes`).** Owner
  directive 2026-08-22: `@hasna/notes` will not ship a macOS app. This package is
  headless — a local-first notes CLI, an MCP server, an importable SDK, and a
  self-hosted HTTP server (SQLite or PostgreSQL).

  Removed from this package: the SwiftPM manifest (`Package.swift`), the native
  WKWebView shell and store library (`Sources/HasnaNotesApp`,
  `Sources/HasnaNotesCore`, `Sources/HasnaNotesSmoke`), the bundled browser UI
  (`web/`), the AI sidecar server (`ai-sidecar/`), the brand/app-icon assets
  (`assets/`), and the app build and deploy scripts (`scripts/build_notes.sh`,
  `scripts/deploy_notes.sh`, `scripts/notes-deploy-lib.sh`). The app-only tooling
  went with them: the web-UI screenshot harness (`tools/shoot.mjs`, which rendered
  the deleted `web/index.html`) and the app-icon rasterizer
  (`tools/render-appicon.mjs`, which read and rewrote the deleted `assets/brand`
  tree), plus the `tools/shots/` ignore entry that only existed for the harness's
  output. So did the app and web-UI documentation: `docs/design-rules-macos26.md`
  (macOS 26 design rules), `docs/ui-contracts.md` (the `window.HasnaNotes` bridge
  and boot-payload contract for the deleted web UI), and
  `docs/brand-visual-system.md` (the app-icon and menu-bar asset system).
  `docs/storage.md` and `docs/sync.md` stay — they document the headless package.
  The app-surface tests went with them, and `test/app-removal.test.mjs` now guards
  every removed path against reintroduction. The final upstream commits carrying
  the app in this repo are **da9764f4 (#638)** and **5a449b417**.

  **No published surface changed.** The `bin` entries (`notes`, `notes-mcp`,
  `notes-serve`), the `exports` map (`.`, `./sdk`, `./events`), and the `files`
  array are byte-identical, so the npm payload is unchanged. Voice capture,
  realtime transcription, and the chat UI were app surfaces and moved with the app;
  the `--sidecar <url>` title client remains and now points at any endpoint
  exposing `POST /title` (this package ships the client, not the server).

  Two manifest edits were required and are not payload changes: `"ai-sidecar"` was
  dropped from `workspaces` in this package and from `apps/notes/ai-sidecar` in the
  monorepo root `package.json` — without them `bun install` fails with
  `Workspace not found "ai-sidecar"`. Dropping the sidecar's exact `ws@8.18.3` pin
  lets the root lockfile resolve `ws@8.21.3`, which other monorepo members already
  required (`^8.20.0`, `^8.21.0`).

  Interoperability is unchanged: the `personalnotes/v1` wire dialect and the
  Markdown-with-YAML-frontmatter on-disk format are the shared contract between this
  package and the desktop app.

## 0.3.0

### Minor Changes

- 82060a8: Remove multi-machine sync machinery (single-server model): the `notes sync`/`cloud`/`billing` CLI verbs, the sync daemon and service install, the GUI SyncScheduler, sync-state handling, the machine manifest and the Machines UI surface, and the server's `/api/v1/sync` endpoint with its `sync_batches` table. The client is now a plain HTTP API client; the `personalnotes/v1` wire dialect and the server's CRUD/export endpoints are unchanged. The one-release pre-rename `PERSONALNOTES_*` env compatibility aliases are removed with it.
- 913fa46: Two-backend storage transition (cloud workflow task 5b2d66b4, owner-authorized 2026-08-17):

  - Server: `HASNA_NOTES_DATABASE_URL` present selects PostgreSQL (schema_migrations ledger, sha256 checksums, sync_batches dropped in the new backend), absent selects the unchanged SQLite default. Migration runner `scripts/apply-postgres-migrations.mjs` (`--dry-run --json`, owner DSN `HASNA_NOTES_DATABASE_URL_OWNER`; the DSN is never logged).
  - Client: one transport resolver — `HASNA_NOTES_API_URL` present selects the HTTP API client over the personalnotes/v1 dialect (api-key auth; a URL without a key fails closed), absent selects the local SQLite+markdown store. Client note-reading and note-writing paths never read the database URL and never open Postgres; the one exception is the `notes storage migrate --dry-run` planning verb, which reads `HASNA_NOTES_DATABASE_URL` and opens a short-lived PG pool to compute the migration plan (fail-closed: no DSN, no plan).
  - `notes storage status` / `notes storage migrate --dry-run` verbs; hasna.contract.json declares the storage block, service metadata, sdk surface, and the Dockerfile self-host artifact; `contracts validate apps/notes/hasna.contract.json` passes.
  - Bins are bun-only: all three bins (`notes`, `notes-mcp`, `notes-serve`) now carry `#!/usr/bin/env bun` and `engines` declares `bun >= 1.0` — the CLI graph imports the vendored storage-kit and `server/pg-migrations.ts`, which only Bun can resolve (Node cannot load the `.js`-specifier `.ts` modules).

  Breaking for downstream consumers: the CLI/MCP bins require Bun (previously ran under Node), and multi-machine sync machinery is removed in the sibling PR (single-server model).

### Patch Changes

- da9764f: macOS app notes live in the hosted path only (cloud-only storage, owner brief 2026-08-19, todos eca5b6da):

  - The macOS app host (`Sources/HasnaNotesApp` NotesBridge) now reads and writes notes exclusively through the hosted notes API selected by `HASNA_NOTES_API_URL` + `HASNA_NOTES_API_KEY` (personalnotes/v1 dialect, via a Swift mirror of the client transport + a new `NotesHttpStore`). The on-disk `MarkdownStore` is no longer the app's store: an API URL without its key fails closed, and an unconfigured app shows a configuration banner instead of falling back to local note files.
  - Bridge verbs map onto the wire dialect: trash is the soft-delete tombstone (`deletedAt`), archive maps to `archived`, restore is a PATCH on the tombstoned row, labels derive from the stored notes, and the trash-retention preference is a UserDefaults UI preference (the API has no settings surface; trash is never purged).
  - Server: PATCH on a soft-deleted note now restores it (clears the delete tombstone and logs `note.restored`) — closes the GAP-2 "REST restore impossible" gap that made trash irreversible over HTTP.
  - Transport resolution and the store verbs are regression-tested in the Swift smoke harness against a stub transport; the restore path is regression-tested in `server/server.test.mjs`.

  Not breaking for existing self-hosted users: the CLI/MCP/server surfaces are unchanged; the change is app-host storage and one dialect behavior (PATCH on deleted rows previously 404'd).

- f0fce61: Owner UX brief 2026-08-19 for the macOS notes app (web UI + native shell):

  - Recording screen (req 1): recent notes hide while recording; the composer input is smaller (360px cap, not full-width); only the pause control and the timer stay.
  - Glass sidebar (req 3): the purple gradient fill is replaced with a translucent material over the canvas (light ~.58 / dark ~.55 + backdrop blur), dark-canvas text, accent active/focus/scroll tokens — in both themes, app and settings shells.
  - Home higher / tighter sidebar top (req 4): home content sits at 6vh instead of dead-center; the native sidebar top padding drops 10px → 4px (traffic-light keep-out untouched).
  - Note header (req 5): 'Updated just now' moves onto the top header row, aligned with copy/trash/comments/minimize (data-no-drag).
  - Recording popover (req 6): the timer pill sits bottom-center of the window (offset for the sidebar, like the toast), visible on every screen including Home and while the note is being added; the duplicate in-circle composer timer is suppressed.
  - Labels (req 7): double-click a label (sidebar filter row or Settings → Labels) — or the pencil icon — edits it inline (Enter/blur commits, Esc cancels); no more window.prompt.
  - Trash/archive (req 8): settings/trash/archive become an icon-only row at the sidebar bottom; archive is blended into just Trash (archiving sends notes to Trash; the Trash view shows trashed + archived); trash is never deleted — permanent purge, expired-trash cleanup, the retention picker and the "Deleted forever" countdown are removed, and the native bridge delete()/purge() refuse to delete.
  - Settings (req 9): the documented #settings[/tab] deep-link hash is implemented (load + hashchange); renderContent no longer falls through to the editor while the settings shell is active; and the native shell's broken `window.Hasna Notes` hydrate/destroy/recCommand calls (JS SyntaxError since the rename) are fixed to `window.HasnaNotes`.
  - App title (req 10): verified 'Hasna Notes' (with the space) on every user-visible surface; no code change needed.

  Agent: notes-fix-web

- Updated dependencies [b630c48]
  - @hasna/contracts@0.11.2
  - @hasna/events@0.1.16

## 0.2.1

### Patch Changes

- 9ef7bee: CLI note commands route through the HTTP API when configured: `notes list`,
  `notes get`, `notes create` and `notes delete` now dispatch through
  `HASNA_NOTES_API_URL` + `HASNA_NOTES_API_KEY` via the personalnotes/v1 wire
  dialect (the plain HTTP client the single-server model specifies) instead of
  silently operating on the local store. Fixes the SDK's `resolveNotesClientStore`
  (re-export-only imports shadowed local bindings, so the resolver threw
  `ReferenceError` on the http path). Adds `notes --version`. The Dockerfile
  bakes the public Amazon RDS global CA bundle so the storage kit's verified TLS
  (`sslmode=require`) can validate the RDS server certificate in the internal
  deployment; the bundle path is served to the kit through `PGSSLROOTCERT`.

## 0.2.0

### Minor Changes

- 82060a8: Remove multi-machine sync machinery (single-server model): the `notes sync`/`cloud`/`billing` CLI verbs, the sync daemon and service install, the GUI SyncScheduler, sync-state handling, the machine manifest and the Machines UI surface, and the server's `/api/v1/sync` endpoint with its `sync_batches` table. The client is now a plain HTTP API client; the `personalnotes/v1` wire dialect and the server's CRUD/export endpoints are unchanged. The one-release pre-rename `PERSONALNOTES_*` env compatibility aliases are removed with it.
- 913fa46: Two-backend storage transition (cloud workflow task 5b2d66b4, owner-authorized 2026-08-17):

  - Server: `HASNA_NOTES_DATABASE_URL` present selects PostgreSQL (schema_migrations ledger, sha256 checksums, sync_batches dropped in the new backend), absent selects the unchanged SQLite default. Migration runner `scripts/apply-postgres-migrations.mjs` (`--dry-run --json`, owner DSN `HASNA_NOTES_DATABASE_URL_OWNER`; the DSN is never logged).
  - Client: one transport resolver — `HASNA_NOTES_API_URL` present selects the HTTP API client over the personalnotes/v1 dialect (api-key auth; a URL without a key fails closed), absent selects the local SQLite+markdown store. Client note-reading and note-writing paths never read the database URL and never open Postgres; the one exception is the `notes storage migrate --dry-run` planning verb, which reads `HASNA_NOTES_DATABASE_URL` and opens a short-lived PG pool to compute the migration plan (fail-closed: no DSN, no plan).
  - `notes storage status` / `notes storage migrate --dry-run` verbs; hasna.contract.json declares the storage block, service metadata, sdk surface, and the Dockerfile self-host artifact; `contracts validate apps/notes/hasna.contract.json` passes.
  - Bins are bun-only: all three bins (`notes`, `notes-mcp`, `notes-serve`) now carry `#!/usr/bin/env bun` and `engines` declares `bun >= 1.0` — the CLI graph imports the vendored storage-kit and `server/pg-migrations.ts`, which only Bun can resolve (Node cannot load the `.js`-specifier `.ts` modules).

  Breaking for downstream consumers: the CLI/MCP bins require Bun (previously ran under Node), and multi-machine sync machinery is removed in the sibling PR (single-server model).

## 0.1.1

### Patch Changes

- 603420e: macOS app rename + proper signing: the WKWebView shell builds as HasnaNotes.app (bundle id com.hasna.notes unchanged), signed with the fleet Developer ID identity "Developer ID Application: VASILE ANDREI HASNA (HKZ326A8Y3)" instead of ad-hoc. In-app UI strings, web UI branding, and the JS bridge global are renamed to HasnaNotes (window.PersonalNotes alias removed); the sidecar auth header is now X-Hasna-Notes-Token only. Build/deploy scripts renamed to scripts/build_notes.sh and scripts/deploy_notes.sh; deploy backs up and removes legacy installs that share the bundle id (bundle-id scan, no hardcoded legacy display names).
- 7c0cc88: First release under the new name: the app previously published as @hasna/personalnotes is renamed to @hasna/notes (apps/notes, HasnaNotes.app, bundle id com.hasna.notes). Renames the CLI/MCP/serve bins to notes/notes-mcp/notes-serve, moves env vars to HASNA*NOTES*\* (legacy names still honored for one release with a deprecation warning), migrates the config path to ~/.config/hasna-notes/config.json, and fixes the package contract (cli-with-store with the SQLite storage block). The sync wire dialect keeps the personalnotes/v1 name.
