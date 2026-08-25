# Changelog

## 1.4.4

### Patch Changes

- Metadata-only release: no runtime or package code changed from 1.4.3. A delayed changeset referencing the 1.4.3 endpoint-removal change (PR #1106, commit 7001497d, already shipped in 1.4.3) was consumed by Version Packages (#1168), producing this version bump.

## 1.4.3

### Patch Changes

- Remove 23 registrable domains that were unregistered yet hardcoded as default endpoints in shipped connector code, each contacted with the user's API key as an Authorization: Bearer token. A connector now sends API keys only to endpoints the user registered (todos 6109cc1b, PR #1106).

## 1.4.2

### Patch Changes

- 0d4f749: Add `prepack: bun run build` so `npm pack` and `npm publish` ship the built `dist` that each package's `main` points to. Previously only `prepublishOnly` built, so a clean-clone `npm pack` shipped a tarball with no code. Also add a repo-root `.editorconfig` with the member-standard style (2-space indent, LF, final newline).
- Fix browser auto-open on Windows: the W2-12 browser-launch change hand-rolled `spawn("start", url)`, which fails on Windows because `start` is a `cmd.exe` built-in, not an executable. The OAuth flow and `serve` now delegate to the `open` package (the Windows-capable opener with safe argument handling) and report when the browser cannot be opened instead of claiming it was.
- Harden the release gates: the package secret guard now applies token and credentialed-URL rules to every shipped text file (generated `bin/`/`dist`/`dashboard/dist` bundles included, scanned after the build), and the monorepo publish guard now scans packed file CONTENTS for internal-infra strings, not only entry names.
- Fix connect-telegram: incoming media/images were not downloadable via the `updates` command (OPE-00106).
- Fix split-io: correct segment key API paths and the dashboard auth field.

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.4.1] - 2026-07-27

### Security

- **Brand-owned DNS domains removed from the published artifact.** 1.4.0 shipped
  real deployment hostnames in `connectors/zendesk` config templates and docs,
  in two other connectors' comments and examples, in `SECURITY.md`, and — via a
  bundled dependency literal with no occurrence anywhere in this repo's source —
  in the compiled `bin/index.js`. Every occurrence of an owned DNS domain is gone
  from the tarball this package publishes. Verified against the packed tarball
  rather than the working tree, because the working tree was never where the
  whole problem was.

  Two limits on that claim, stated because "hostnames removed" would overstate it:

  - `@hasna/events` is externalized out of `bin/index.js` (see _Changed_) but is
    still a runtime dependency, and its own published package continues to carry
    the literal. `npm install` therefore still places an owned domain on disk.
    Removing it belongs to that package, and is tracked there.
  - Scope here is DNS domains. Deployment **resource identifiers** — the
    instance, database and bucket names in `connectors/zendesk`'s docs, `Makefile`
    and `.env.example`, together with the naming pattern they follow — are
    unchanged from 1.4.0 and still ship. They are a separate class with a
    separate fix, tracked separately; this release does not address them and
    should not be read as having done so.

### Changed

- **`connect-zendesk` no longer ships a default remote API URL.** The value was
  a hardcoded deployment host used as a fallback. It now comes from
  `ZENDESK_REMOTE_API_URL` or `connect-zendesk config set-remote-url <url>`.
  `config show` and `remote url` report `not set`; `remote status` and
  `remote health` exit non-zero with guidance naming both mechanisms. `make`'s
  deploy banner reads a new overridable `REMOTE_API_URL`.
- **Vulnerability reports go through GitHub Security Advisories** instead of an
  email address. Private vulnerability reporting is enabled on the repository.
- `@hasna/events` is marked external in the CLI bundle, joining the existing
  `ink` / `react` / `chalk` / `conf` externals. It is a declared runtime
  dependency, so npm resolves it at install time.

### Fixed

- `.test-home/` sandboxes and per-connector lockfiles are no longer swept into
  the published tarball by `files: ["connectors/"]`. 1.4.0 shipped a Bun
  install-cache blob this way.
- 1.4.0 shipped `.d.ts` files for two modules deleted in 1.4.0 itself, because
  `dist/` was not clean at release time.

## [1.4.0] - 2026-07-26

### Removed

- **BREAKING: the `connectors cloud` command group is gone**, along with the
  `@hasna/cloud` dependency. `hasna/cloud` is deleted and formally unsupported
  (owner ruling 2026-07-26); the repo will not be restored, so depending on it
  was both a `no_cloud_guard` contract breach and a build one unpublish away
  from breaking. A fleet conformance sweep found it wired into the core DB
  layer. Removed: `connectors cloud sync push|pull|status` and everything
  `registerCloudCommands` provided (`src/cli/commands/sync.ts`), the cloud MCP
  tools via `registerCloudTools` (the server now serves 34 tools), and
  `src/db/pg-migrations.ts`, which had no consumers and existed only to mirror
  the SQLite schema for that sync. All of it served one purpose — syncing local
  SQLite into a shared Postgres — which is exactly the pattern being retired.
  There is no replacement; connectors is local-first.

### Changed

- **`SqliteAdapter` is now in-repo** at `src/db/sqlite-adapter.ts` instead of
  being imported from `@hasna/cloud`. The original was itself a thin wrapper
  over `bun:sqlite`, so this is a like-for-like swap; `src/db/database.ts`
  re-exports it and every `type Database` consumer is unchanged. Both original
  PRAGMAs are preserved, including `foreign_keys=ON`, which is load-bearing for
  `connector_job_runs`' `ON DELETE CASCADE`. Bindings are typed
  `SQLQueryBindings | SQLQueryBindings[]` because call sites use both the spread
  and array forms.

### Added

- `src/no-cloud-boundary.test.ts` fails the build if `@hasna/cloud` is
  reintroduced — as a dependency, as an import in any source file, or as a
  registration symbol in the CLI or MCP server. It matches module specifiers
  rather than bare mentions, so prose explaining the removal does not trip it.

### Tests

- **`connect-x` OAuth 2.0: lock in public-client token exchange (#1).** Added
  `connectors/x/src/api/oauth.test.ts` covering `exchangeCodeForTokens`,
  `refreshAccessToken`, and `revokeToken`. The suite asserts that the connector
  authenticates the client with POST body parameters (`client_id`, plus
  `client_secret` when one is configured) and never sends an
  `Authorization: Basic` header to `/2/oauth2/token` or `/2/oauth2/revoke` —
  the header X rejects with
  `unauthorized_client / "Missing valid authorization header"` when the app is
  registered as a public client. Test-only; no runtime change (the behaviour
  itself was fixed in `5789e155`, released in 1.3.5).

## [1.3.46] - 2026-07-24

### Fixed

- **Reconcile `main` to the published npm line.** `main`'s `package.json` was stamped
  `1.3.41` while npm `latest` was `1.3.45`. Versions `1.3.43`, `1.3.44`, and `1.3.45` were
  published on 2026-07-24 (13:47–14:15 UTC) by hand-bumping `package.json` in the registry-drain
  working tree and running `npm publish` **without committing or tagging the bump** — so no git
  ref carried `1.3.43`–`1.3.45`. Verification confirmed the published `1.3.45` artifact is a
  strict subset of `main` (HEAD = #330 registry drain): published `package.json` is byte-identical
  to `main` except the version field (same deps incl. `@hasna/cloud`/`pg`, same scripts, exports,
  bin), `README.md` is identical, and every connector shipped in `1.3.45` (1148 dirs) is present
  in `main` (1149; `main` additionally has `connect-googleads`). No published behavior was
  missing from `main`, so no source merge was required — only the version needed to move above
  the published line. Bumped to `1.3.46` and tagged so `main` == npm going forward and the next
  publish is monotonic. (The `codewith/no-cloud-connectors` branch @ `1.3.42`, which removed the
  cloud runtime, is a superseded experiment — npm `1.3.45` re-includes `@hasna/cloud` — and is
  intentionally NOT merged.)

### Added

- Registry integration: added 111 net-new connectors in a single batch, consolidating
  111 individual "feat: add <vendor> connector" PRs that were all colliding on the shared
  `src/lib/connectors/*.ts` registry files. Each connector's directory was taken from its
  originating PR head and its metadata entry appended to the correct category registry file
  (deduped against the existing registry; no duplicate names). Represented PRs: #8, #14, #31,
  #36, #37, #40, #41, #45, #46, #48, #49, #50, #54, #55, #58, #60, #64, #72, #74, #75, #76,
  #84, #87, #88, #91, #92, #93, #94, #95, #96, #97, #101, #102, #103, #104, #105, #106, #107,
  #108, #109, #110, #113, #115, #116, #118, #120, #121, #122, #123, #124, #127, #129, #130,
  #131, #134, #135, #136, #137, #138, #139, #140, #141, #142, #143, #144, #146, #150, #151,
  #155, #157, #162, #163, #171, #173, #175, #178, #180, #183, #187, #188, #198, #201, #220,
  #221, #222, #244, #246, #248, #249, #250, #251, #252, #254, #257, #261, #262, #264, #267,
  #273, #274, #275, #277, #279, #282, #289, #292, #295, #298, #321, #326, #328.

## [0.3.1] - 2026-03-12

### Added

- `GET /api/connectors?compact=true` — returns `{name, category, installed}` only (61% smaller: ~2,700 → ~1,054 tokens)
- `GET /api/connectors?fields=name,category,installed` — arbitrary field filtering for any subset of connector fields

## [0.3.0] - 2026-03-12

### Changed

- MCP lean stubs: removed all `.describe()` from Zod params across all 12 tools
- All tool schemas now bare types only; full descriptions available on-demand via `describe_tools`
- Real measured reduction: 3,500 → 2,248 chars (~36%, ~313 tokens) vs v0.2.7 baseline
- Note: 12-tool MCP gains are modest; pattern has larger impact on MCPs with 40+ tools

## [0.2.9] - 2026-03-11

### Added

- `list_connectors` MCP tool: `compact=true` returns names-only array (~70% smaller response)
- `connector_docs` MCP tool: `essential=true` returns auth+envVars only (skips overview/CLI/storage)
- `search_tools` MCP tool: list/filter tool names without loading all descriptions
- `describe_tools` MCP tool: get descriptions for specific tools by name

## [0.2.8] - 2026-03-11

### Changed

- Trimmed all 10 MCP tool descriptions to <60 chars (compact-by-default pattern)
- MCP input schema param descriptions shortened throughout

## [0.2.7] - 2026-03-11

### Changed

- Updated all 62 connector CLAUDE.md files with 2026 API changes:
  - AI models: Claude 4.6, GPT-5.x, Grok-4, Gemini 3.1 Pro, Mistral Large 3, ElevenLabs v3
  - Breaking changes: Notion 2026-03-11, Shopify REST→GraphQL, Meta Graph v24, Revolut DCR
  - New endpoints: Mercury webhooks/SAFE, Webflow Comments/MCP, Resend list emails, Firecrawl /agent
  - Auth changes: Reddit pay-as-you-go, X API credits model, Google Maps client ID deprecation
  - Developer tools: Cloudflare Workers beta API, shadcn CLI v4, Figma MCP Server
  - Anthropic connector: TypeScript types updated with claude-opus-4-6/sonnet-4-6, adaptive thinking

## [0.2.6] - 2026-03-11

### Added

- `connectors env` — generate `.env.example` from installed connectors' required env vars
- `connectors presets` — list preset bundles (ai, fullstack, google, social, devtools, commerce)
- `connectors install --preset ai` — install all connectors in a preset bundle
- `connectors whoami` — show setup summary (version, config dir, auth status per connector)
- `connectors test [name]` — verify API credentials with real HTTP requests (16 endpoints)
- Test endpoint definitions for 16 connectors (anthropic, openai, stripe, github, figma, etc.)
- 12 new CLI tests (380 total)

## [0.2.5] - 2026-03-10

### Added

- `connectors list --brief` flag for concise output (just names, ideal for AI agents)
- `connectors install --category "AI & ML"` to install all connectors in a category
- `connectors export` / `connectors import` CLI commands for credential backup/restore
- `connectors upgrade` command to check for and install latest version
- `connectors completions bash|zsh|fish` for shell tab completion
- Conditional postinstall: skips dashboard install if `SKIP_DASHBOARD=1` or already installed
- 14 new CLI tests (368 total)

### Changed

- `connectors auth --key` now always echoes which field was saved
- postinstall no longer re-installs dashboard deps unnecessarily

## [0.2.4] - 2026-03-10

### Added

- Auto-detect available port when default port is in use (server gracefully falls back)
- `configure_auth` MCP tool — AI agents can now save API keys programmatically
- `list_categories` MCP tool — list all connector categories with counts
- 38 new tests (350 total across 9 test files)
- Server route tests: install, uninstall, update, activity, profiles, export/import
- Auth unit tests: listProfiles, switchProfile, deleteProfile
- MCP connector_auth_status tool tests

### Fixed

- Installer test assertion checking wrong directory name (.connectors vs .connect)
- MCP server version synced with package version (was 0.1.0, now 0.2.4)

## [0.2.2] - 2026-02-15

### Added

- 96 new tests (312 total across 9 test files, 2,120 assertions)
- Library exports test (`src/index.test.ts`)
- Dashboard template test (`src/server/dashboard.test.ts`)
- Server entry point test (`src/server/server-entry.test.ts`)
- Auth OAuth flow tests (getEnvVars, getOAuthStartUrl, validateOAuthState)
- Server route tests (refresh, OAuth start/callback, name validation)
- CLI component tests (SearchView, InstallProgress, ConnectorSelect)
- Installer edge case tests (path traversal, invalid names)
- SECURITY.md with vulnerability reporting policy

### Fixed

- Missing `"license": "Apache-2.0"` in 4 connector package.json files
- Added `homepage` and `bugs` fields to root package.json
- TypeScript strict null check in component test

## [0.2.0] - 2026-02-14

### Added

- TypeScript declaration files (`dist/index.d.ts`) for npm users
- `connectors update` command to refresh installed connectors
- Post-install guidance showing import path, docs, and dashboard
- CI/CD workflow (GitHub Actions)
- CHANGELOG, CODE_OF_CONDUCT, issue/PR templates
- Server and auth test suite (37 new tests, 216 total)
- Development section in README and expanded CONTRIBUTING.md

### Security

- CSRF state parameter for OAuth flows
- Connector name validation to prevent path traversal
- Scoped CORS to localhost instead of wildcard
- Security headers (X-Content-Type-Options, X-Frame-Options)
- Request body size limits and fetch timeouts
- Graceful shutdown handlers (SIGINT/SIGTERM)

### Fixed

- Removed blacklisted connect-browseruse connector (62 connectors)
- Fixed repository URLs in all connector package.json files
- Removed internal references (beepmedia, hasnaxyz)
- Fixed 7 TypeScript errors in Ink components
- Fixed ESM imports in installer.ts (replaced require() calls)

### Changed

- License changed from MIT to Apache-2.0
- Merged serve/open CLI commands (open is now alias of serve)
- prepublishOnly now runs tests before build
- Dashboard deps auto-install via postinstall

## [0.1.0] - 2025-06-01

### Added

- Initial open-source release
- 62 TypeScript API connectors
- CLI with interactive browser (`connectors i`)
- MCP server for AI agents (`connectors-mcp`)
- Local dashboard with shadcn/ui (`connectors serve`)
- Apache-2.0 license
