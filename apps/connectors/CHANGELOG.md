# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
