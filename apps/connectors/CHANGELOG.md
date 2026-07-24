# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
