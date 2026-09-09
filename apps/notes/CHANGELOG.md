# @hasna/notes

## 0.6.1

### Patch Changes

- notes-serve bounds passwordless login without giving anyone a lockout
  primitive, and its per-IP limits now see the real client behind the fleet's
  proxies.

  **Login requests carry a nonce.** `POST /auth/login` mints a request per call:
  a six-digit code (delivered to the address) and an opaque `requestId`,
  returned only to the requester. `POST /auth/verify` now takes
  `{ email, code, requestId }` — `requestId` is required — and looks the request
  up by its nonce, never "the latest code for the address". A request that does
  not resolve is refused before anything is counted. Wrong codes count against
  that request and burn it after 5; after that even the correct code is refused
  and the holder simply requests a new one. Nothing is keyed on the address: a
  stranger can only burn requests it minted itself, so guessing is bounded at
  five tries per code while N IPs requesting codes for an address and guessing
  at them cannot stop its owner from logging in. Minting is bounded per source
  IP (5/hour) and by a process-wide budget (300 codes per minute,
  `otpMintBudget`). Storage gains `otp_login_requests.failed_attempts`
  (PostgreSQL migration `notes_pg_010`, additive).

  This replaces the per-email hourly quota from #1756 (anyone who knew an
  address could spend its budget from throwaway IPs) and the #1761 code burn
  keyed on the address (ten throwaway IPs could kill the owner's code).

  **Per-IP limits behind proxies (#1784).** Behind the fleet ALB the socket peer
  is the balancer, so every user shared one bucket and 21 wrong verifies from
  one machine locked everyone out for an hour. `HASNA_NOTES_SERVER_TRUSTED_PROXY_HOPS`
  (default `0`; the image sets `1`) names how many `x-forwarded-for`-appending
  proxies to trust, counted from the right — never the leftmost, client-written
  entry. `HASNA_NOTES_SERVER_TRUSTED_GATEWAY_PEERS` (IPs/CIDRs) lets `x-real-ip`
  from the api.hasna.com gateway's egress identify the client; from any other
  peer it is ignored. `--auto-approve` keeps deciding on the raw socket peer.

  Login codes stay out of the server log: the request line records only the
  address and the expiry, and the code itself is printed only under the explicit
  `HASNA_NOTES_SERVER_AUTH_CONSOLE_CODES=1` opt-in (or `--dev`, which returns it
  in the response body). Fixes hasna/apps#1542; follow-up to #1761 and the #1770
  reviews; addresses #1784 for this server.

- Add a typed browser-safe Notes client with explicit authority and per-request credentials, shared SaaS wire fixtures, trash restore, revision preconditions, label operations and paged changes. Preserve the existing Node resolver and independent command surfaces.

## 0.6.0

### Minor Changes

- a053564: Resolve credentials and authority through the `@hasna/contracts` client chain
  (hasna/apps#1720), and move the client wire dialect to the `/v1` authority root.

  The CLI, the MCP server and the `./sdk` client no longer read canonical env
  variables by hand. All three call the one resolver in `@hasna/contracts`
  (bumped from 0.10.6 to the exact 1.0.2), per call, fresh: an explicit
  `apiKey`/`profile` argument, then `HASNA_NOTES_API_KEY_OVERRIDE` /
  `HASNA_PROFILE` / `HASNA_NOTES_API_KEY_REF`, then the macOS Keychain item
  `hasna.credentials.notes.api-key`, then `~/.hasna/notes/config/credentials`
  (owner-only 0400/0600), then `HASNA_NOTES_API_KEY`. The authority follows the
  same ladder — `HASNA_NOTES_API_URL`, the Keychain `api-url` item, the
  credentials file — and now DEFAULTS to the fleet gateway
  `https://api.hasna.com/notes` once a credential resolves, so a key alone is a
  complete configuration. Resolving per call is what makes a rotation heal a
  long-lived MCP server, shell or agent without restarting it: every request
  re-resolves, and the transport refuses to send when the authority or
  credential changed since the client was built.

  What this removes:

  - The app's own credential chain in `client/transport.mjs` (environment
    snapshot + hand-rolled URL/DSN checks): nothing reads `~/.hasna/fleet-env`,
    `~/.hasna/cloud`, `~/.config/hasna` or `$XDG_CONFIG_HOME`, and no client
    surface resolves a key outside `@hasna/contracts`.
  - The legacy-env DEPRECATED notice class: `HASNA_NOTES_API_KEY` remains a
    legitimate tier, it simply sits below Keychain and disk.
  - The `/api/v1` wire prefix. The client, the server routes, auth, the OpenAPI
    document, the device page and the dialect docs all speak the `/v1`
    authority root (`/v1/notes`, `/v1/export`, `/v1/auth/...`). The
    `personalnotes/v1` wire NAME and the unversioned `/api/auth` login mirror
    are unchanged. Self-hosted servers must move any pinned `/api/v1/*`
    endpoint to `/v1/*`; the server answers `GET /v1` (dialect discovery),
    `/v1/health`, `/ready`, `/version` and `/openapi.json`.

  What this adds:

  - `notes storage status` (JSON and text) reports `baseUrl`, `apiUrlSource`,
    `apiKeySource` and `apiKeyTier` — WHICH tier supplied the credential
    (never the value).
  - The SDK re-exports the resolver seam (`resolveNotesClientTransport`,
    `createNotesHttpStore`, `NotesHttpStoreError`) unchanged in shape, with the
    new report fields.

  Behaviour worth knowing about:

  - Hosted mode with no credential still fails closed — non-zero exit, no
    SQLite, no local-fallback event — and the message now names the tier and
    file it consulted. There is deliberately NO local mode to opt into.
  - A declared-but-blank variable is a refusal, not an absence, and — because
    the resolver is given the live `process.env` AS-IS, never a copy (#1788) —
    a blank `HASNA_NOTES_*` variable can no longer silently switch the ambient
    Keychain tier off.
  - An explicit base URL with no explicit API key is refused outright: the
    ambient fleet credential is never attached to an arbitrary authority
    (#1794).
  - The transport treats every 3xx as terminal (redirect never followed),
    cancels 401/403 response bodies unread, and surfaces the credential SOURCE
    (never the value) in auth failures. The notes store's error envelope
    (`NotesHttpStoreError` with status/code/details and credential redaction)
    is preserved.
  - The server is unchanged in storage/auth semantics; it remains
    PostgreSQL-only with the mandatory server-only `HASNA_NOTES_DATABASE_URL`.

### Patch Changes

- f115060: Resolver validation fixes for the @hasna/contracts credential chain
  (hasna/apps#1720, notes P1 lane, round 1).

  - **Non-JSON responses name the HTTP status.** `NotesHttpStoreError` for a
    non-JSON body now reads `Notes API GET /notes returned HTTP 404 with a
non-JSON body` (code `invalid_json`, `status` set) instead of `returned
invalid JSON`, so the CLI and MCP — which print only the message — let an
    operator tell a gateway/deployment mismatch (an origin that does not serve
    `/v1` answers 404 text/plain) apart from a corrupt body.
  - **`storage status` reports `apiUrlPresent` honestly.** The transport report's
    `api_url_present` was a copy of `api_key_present`; it is now true when an
    operator configured the authority (`HASNA_NOTES_API_URL`, the Keychain
    `api-url` item, or the credentials file) and false when the default fleet
    gateway applied (`apiUrlSource: "default"`).
  - **Maintenance path module is name-only.** `server/paths.mjs` keeps just the
    data-home branch (`HASNA_DATA_HOME`, else the platform data location): the
    unused config/state/cache branches — including the retired `~/.config/hasna`
    path shape — the unprefixed `NOTES_HOME` override and the import-time
    `DEFAULT_DB_PATH` (`<data root>/server.db`) constant are removed. Exact
    overrides stay `HASNA_NOTES_HOME`, then `HASNA_NOTES_ROOT`. Credentials and
    the service authority never resolved here (the contracts chain owns
    `~/.hasna/notes/config/credentials` and `HASNA_HOME`).
  - **Hermetic bin/MCP tests.** The bin-runtime and MCP edge suites pin
    `HASNA_STATION` to a sentinel account and hand the child a throwaway
    `HASNA_HOME`, so a provisioned macOS station's Keychain items can no longer
    turn the fixed-authority case into an authority conflict or the
    no-credential case into a live fleet request. Both suites now also assert
    the fail-closed first stderr line names every credential tier and that
    nothing (no `*.db`, no data root) is created under the fake home.

  No client behaviour changes otherwise: hosted with no credential still fails
  closed on the CLI, MCP and `./sdk`, and there is no local fallback.

## 0.5.0

### Minor Changes

- **Breaking (pre-1.0):** CLI, MCP, SDK and package-root operations require an authenticated HTTPS Notes service. Missing credentials and client database URLs fail closed; local Markdown/SQLite CRUD and automatic local fallback are removed. Both authenticated fetch paths reject redirects. Pure Markdown formatting remains available through `@hasna/notes/compat/markdown-format`.
- The server requires PostgreSQL and a server-only database URL. SQLite defaults and retired storage flags are removed. This package release does not deploy a service or import existing records.
- Maintenance paths use the XDG-native resolver. Legacy data is never selected, moved or copied implicitly; explicit fingerprint-bound copy-only migration preserves source files and rejects conflicts, symlinks and receipt replacement.
- Verify the production PostgreSQL schema, OTP/API-key authentication and note write/read round-trip in isolated CI, including a missing-configuration negative control. The separate PersonalNotes product and existing `personalnotes/v1` wire dialect remain unchanged.

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

- **BREAKING (pre-1.0 minor):** CLI, MCP, SDK and package-root note access now
  require HASNA_NOTES_API_URL plus HASNA_NOTES_API_KEY over HTTPS. No local
  SQLite/Markdown fallback or client DSN path remains. Root imports no longer
  export local CRUD; pure formatting is available only at
  `@hasna/notes/compat/markdown-format`.
- Authenticated API and title-sidecar requests reject every redirect, including
  same-origin HTTPS redirects, so credentials/bodies are never replayed and
  301/302/303 method rewrites cannot report false success.
- **BREAKING:** notes-serve is PostgreSQL-only and requires a valid server-side
  HASNA_NOTES_DATABASE_URL. The SQLite default, --db and HASNA_NOTES_SERVER_DB
  are removed. SQLite is isolated to unshipped test fixtures.
- Maintenance paths use XDG immediately; the previous legacy-root gating and
  implicit copy-forward behavior are removed. Explicit migration preserves
  sources and applies only a reviewed dry-run fingerprint. Copied data is
  non-authoritative import material and is not imported into PostgreSQL.
- The separate PersonalNotes product and `personalnotes/v1` wire name are
  unchanged. Historical release notes below describe their releases, not the
  current behavior.

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
