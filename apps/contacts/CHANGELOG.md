# Changelog

## 0.8.1

### Patch Changes

- a55b941: Fail-closed delivery hardening (hasna/apps#1720): `contacts-mcp` refuses to RUN
  unauthenticated — it resolves the API key and authority through the one
  `@hasna/contracts` client chain BEFORE the stdio transport is connected or the
  HTTP port is bound, exits non-zero with a value-free first-stderr-line
  diagnosis naming where the credential should live (the Keychain item, the
  credentials-file path, `HASNA_CONTACTS_API_KEY`), and creates nothing under the
  app home; `--help` / `--version` still answer ahead of the gate and every tool
  re-resolves per request. The `contacts` CLI fail-closed message now starts on
  the FIRST stderr line instead of behind a leading blank line, so the missing
  credential and its expected sources are the first thing a caller (or an agent
  reading the negative control) sees. Hermetic spawn probes cover the stdio and
  HTTP startup gate, the first-line contract on both the CLI and the MCP server,
  and the value-free diagnosis, all under fake homes with the station pinned
  away.

## 0.8.0

### Minor Changes

- b9626c0: Adopt the @hasna/contracts 1.0.2 credential resolver (owner directive, hasna/apps#1720): CLI, MCP server and store resolve the contacts API key and authority through the shared client chain on every request — explicit argument, deliberate pointers (`HASNA_CONTACTS_API_KEY_OVERRIDE`, `HASNA_PROFILE`, `HASNA_CONTACTS_API_KEY_REF`), macOS Keychain (`hasna.credentials.contacts.api-key` / `.api-url`, account `HASNA_STATION` → short hostname → `$USER`), `~/.hasna/contacts/config/credentials` (0400/0600), then `HASNA_CONTACTS_API_KEY` — with the authority defaulting to the fleet gateway `https://api.hasna.com/contacts` once any credential resolves. No credential fails closed: non-zero exit, no SQLite, no local-fallback event, and the Keychain tier stays ambient across per-request env snapshots (#1788). The SDK keeps an explicit HTTPS `baseUrl` + `apiKey` contract and never attaches an ambient fleet key to an explicit authority (#1794). Legacy client selectors (`HASNA_CONTACTS_STORAGE_MODE`, `CONTACTS_STORAGE_MODE`, DB paths/URLs) are rejected in client processes; the own env/disk chain is gone, and the vendored storage kit is regenerated for 1.0.2.

### Patch Changes

- 998cc91: Resolver validation fixes (hasna/apps#1720): the MCP connection-status and CLI transport tests are hermetic against a populated station Keychain (`HASNA_STATION` pinned to an absent account, `HASNA_HOME` to an empty temporary root, pointer/profile names cleared), the #1788 Keychain-gate test observes the tier through an injected account derivation instead of the machine's Keychain; `contacts status` reports the RESOLVED `/v1` authority plus `api_url_source` / `api_key_source` / `api_key_tier` (names only, never values) and the resolver's `issue` when unconfigured; `contacts-mcp --version` / `--help` and `contacts-serve --help` answer without starting a server or binding a port; `./sdk` gains `createContactsClient()` — the @hasna/contracts chain resolved through the same seam as the CLI and MCP server, the key re-resolved per request with the authority pinned, while an explicit `baseUrl` still requires an explicit `apiKey` (#1794) — and `ContactsV1Client` accepts a gateway path prefix such as `https://api.hasna.com/contacts`; the retired `~/.config/hasna` path shape no longer ships in the client bundle.

## 0.7.0

- **Breaking (pre-1.0 minor):** CLI, MCP, SDK and package-root data operations require an explicitly configured authenticated HTTPS authority. Missing credentials, retired storage selectors and client database URLs fail closed; there is no automatic local SQLite fallback.
- PostgreSQL remains server-only. Isolated CI verifies the actual schema twice and production contact creation, retrieval, email-only updates, deletion and child cascade against PostgreSQL16, with a mandatory missing-configuration negative control.
- Explicit legacy-data preservation copies and verifies source/output bytes without selecting, deleting or moving existing local data. Credential binding and HTTPS redirect refusal remain enforced across public client surfaces.
- Includes the prior monorepo fold. Existing vendored storage-kit provenance is unchanged; this release does not claim regeneration with a newer Contracts kit or deployment/migration of user data.

## Unreleased

- CI: run install, typecheck, build, and tests on pull requests and pushes to `main`

## 0.6.36 — 2026-08-30

- Folded into the hasna/apps monorepo as `@hasna/contacts` (CLI, MCP, serve, SDK surfaces); version matches the npm-published 0.6.36. The standalone github.com/hasna/contacts repo is retired.

## 0.1.0 — 2026-03-20

Initial release.

- CLI: `contacts` command with add/list/show/edit/delete/search/import/export
- MCP server: 24 tools for AI agents
- SQLite storage with FTS5 full-text search
- Import/Export: CSV, vCard, JSON
