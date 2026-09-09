# Changelog

## 0.5.1

### Patch Changes

- 6bcb98d: `logs-mcp` refuses a deliberate credential tier it cannot honour before serving (hasna/apps#1720 validation, round 2). The startup gate now completes a `HASNA_LOGS_API_KEY_REF` vault pointer once — through the same `@hasna/contracts` completion the transport runs per request — so a pointer this process cannot dereference (no `@hasna/secrets`, no secrets-client configuration, an unreachable vault, an empty item) exits 1 with the resolver's TERMINAL message as the first stderr line before `initialize` is answered, instead of starting and refusing every tool call. The MCP self-telemetry store is resolved inside `buildServer()` rather than at module load, so a `HASNA_PROFILE` naming a profile with no key is diagnosed by the gate with the remedy as the first stderr line rather than thrown from the module's top level behind a Bun source frame. Nothing is created in either case; the completed credential is discarded and the transport keeps re-resolving per request.
- 6bcb98d: Resolver validation fixes (hasna/apps#1720): a hosted `logs-mcp` no longer creates `agent-registry.db` under the app home — the agent-lifecycle registry now follows the transport (the persistent on-box file only under the explicit `HASNA_LOGS_LOCAL=1` opt-in, opened lazily on the first tool call; a per-process in-memory registry on the hosted transport, announced in the tool descriptions), and the MCP server resolves its store once at startup so a missing credential exits non-zero with the remedy as the first stderr line before `initialize` is answered and before the Streamable-HTTP listener binds. The local data directory honours `HASNA_HOME` like the credential chain (`$HASNA_HOME/logs`, `HASNA_LOGS_DATA_DIR` still wins) and is resolved per call rather than at module load, so the test suite no longer writes into the real `~/.hasna/logs`. The resolver-backed hosted-API client ships at the canonical `./sdk` subpath (self-contained bundle; `./api` stays as the alias) and the `logs-sdk` contract surface is declared supported; the nested `@hasna/logs-sdk` split-package manifest is deleted. Tests: the hosted api-lane suite resolves through a caller-built env instead of the station Keychain, and the identity repo-id expectation compares resolved paths.
- b966fa9: Bind resolver-backed SDK requests to one authority and a freshly verified credential pair; refuse changed or invalid configuration instead of retaining a stale key. Expose the immutable destination for receipt-bound integrations.

## 0.5.0

### Minor Changes

- 4a3561c: Resolve credentials through the `@hasna/contracts` client chain (hasna/apps#1720).

  The CLI, the MCP server and the `@hasna/logs/api` SDK no longer read a
  credential chain of their own. All three call the one resolver in
  `@hasna/contracts` (pinned to the exact released 1.0.2), which reads, fresh on
  every request: an explicit `--api-key`/`--profile`, then
  `HASNA_LOGS_API_KEY_OVERRIDE` / `HASNA_PROFILE` / `HASNA_LOGS_API_KEY_REF`,
  then the macOS Keychain item `hasna.credentials.logs.api-key` (account
  `HASNA_STATION`, else `hostname -s`, else `USER`), then
  `~/.hasna/logs/config/credentials` (owner-only 0400/0600; `HASNA_HOME` /
  `HASNA_CONFIG_HOME` move the root), then `HASNA_LOGS_API_KEY`. The authority
  follows the same ladder — `HASNA_LOGS_API_URL`, the Keychain `api-url` item,
  the credentials file — and now DEFAULTS to the fleet gateway
  `https://api.hasna.com/logs`, so a key alone is a complete configuration. The
  unprefixed `LOGS_API_URL` / `LOGS_API_KEY` names survive only as the resolver's
  silent alias fallback for one release and NEVER outrank the canonical pair.

  What this removes:

  - The last app-level store selector (`HASNA_LOGS_STORAGE_MODE` /
    `LOGS_STORAGE_MODE` and the other `*_MODE` spellings): inert everywhere, and
    the vendored storage kit's retired mode variables are gone with the kit
    regeneration.
  - The serve's silent SQLite default. `logs-serve` with no
    `HASNA_LOGS_DATABASE_URL` no longer opens the local database on its own:
    it serves the on-box SQLite collector only under the explicit
    `HASNA_LOGS_LOCAL=1` opt-in (printing one `local` line on stderr) and fails
    loud otherwise — the same fail-closed rule as the client surfaces.
  - The local-store documentation that implied SQLite is the serve's default
    (breaking, hence `minor`): a local collector run must now be named.

  What this adds:

  - `@hasna/logs/api` exports `createLogsApiClientFromEnv`, the resolver-backed
    factory for the generated `/v1` client: it throws when no credential
    resolves, refreshes the credential on every request, and pins the
    credential to an EXPLICIT caller-supplied `baseUrl` (hasna/apps#1794) — a
    station's fleet key never rides to a caller-named authority.
  - `logs transport` reports the transport decision and its source (an env key
    NAME, a Keychain item reference, a credential file PATH, the fleet gateway
    default, or the explicit local opt-in) — never a value.
  - The published `.d.ts` no longer imports `@hasna/contracts` at all: the
    crossing client types are spelled locally and pinned identical by tests
    (hasna/apps#1782), so the package's build-time devDependency never leaks
    into a consumer's type-check.
  - The vendored storage kit regenerates to 1.0.2 (server backend resolution is
    now PostgreSQL-fail-closed, matching the fleet doctrine) and
    `hasna.contract.json` moves `kitVersion` and the client env keys to the
    canonical `HASNA_LOGS_*` names.

  Behaviour worth knowing:

  - Hosted mode with no credential still fails closed — non-zero exit, no
    SQLite opened, no local-fallback event — and the message names every tier
    it consulted plus the gateway default.
  - Local mode (`HASNA_LOGS_LOCAL=1`, alias `LOGS_LOCAL=1`) is honoured only
    when the environment configures no authority and no credential, and every
    local run prints one line on stderr saying it is local.
  - The `@hasna/logs-sdk` telemetry package stays zero-dependency by design: it
    pushes to an operator-named collector and reads no environment of its own;
    the canonical names to feed its options are documented in its README.

### Patch Changes

- c736f83: `logs list --json` and `logs get --json` are now accepted as aliases of `--format json`, so scripts passing `--json` on list/read surfaces no longer trip commander's unknown-option rejection (hasna/apps#1602).

## 0.4.8

### Patch Changes

- 3486576: Release-gate remediation (adversarial review of the 0.4.7 candidate): remove the retired `HASNA_LOGS_STORAGE_MODE` env from the Dockerfile (server backend selection is `HASNA_LOGS_DATABASE_URL` only); adopt the store's reported cursor on an empty baseline `watch --events` poll so events ingested after the first poll are emitted instead of repeating the baseline; page the hosted event stream when a service filter is applied so matches beyond the first window are not truncated and `has_more` is computed over the filtered stream (with a safety bound that never reports a silent false — regression tests for both watch defects); regenerate the standalone `bun.lock` against the current manifest (frozen Docker install); regenerate the vendored storage kit to 0.12.0 and align the `@hasna/contracts` pin to `^0.12.0` so the repo conformance gate passes.

## 0.4.7

### Patch Changes

- 0d4f749: Add `prepack: bun run build` so `npm pack` and `npm publish` ship the built `dist` that each package's `main` points to. Previously only `prepublishOnly` built, so a clean-clone `npm pack` shipped a tarball with no code. Also add a repo-root `.editorconfig` with the member-standard style (2-space indent, LF, final newline).

## 0.4.6

### Patch Changes

- 85e329c: Port the local-only store operations to the hosted /v1 backend (localonly-logs): `logs scan` and `logs watch --events` (plus the MCP `event_watch` tool) now work in api mode through the mode-resolved Store — the headless scan executes client-side with every result (logs, perf snapshot, scan-run record, page/job bookkeeping) delivered through the hosted data plane, and the event-catalog live-tail walks (event_time, event_id) cursors via the new `after_time`/`after_id`/`order` query on GET /v1/events. New /v1 maintenance routes: GET/PUT /jobs/:id, POST /jobs/:id/runs, PATCH /jobs/:id/runs/:runId, GET/PATCH /pages/:id, POST /perf/snapshot. The `db doctor` raw-segment family (segments/rebuild-index/repair-segments) stays local-only with the strong reason recorded in src/store/index.ts: the hosted tier deliberately persists no raw JSONL segments (redacted records, raw: null), so those operations have no hosted subject; the reviewer rules on that record.
- Updated dependencies [b630c48]
  - @hasna/events@0.1.16

## 0.4.5

- chore(reconcile): bring `main` up to the published npm line. `main` had diverged
  behind the registry — it sat at 0.3.36 (tip `082c698`, "route ALL log reads+writes
  to cloud API in self_hosted mode") while npm `latest` was 0.4.4. The published tag
  `npm/logs/v0.4.4` was 8 commits ahead of `main` (Store unification / `LocalStore` +
  `ApiStore`, cloud `/v1` data-plane parity + `POST /v1/events` ingest, `watch --server`
  SSE fix, FTS5 query sanitization, releases 0.4.2/0.4.3), and `main` had **zero**
  commits that were not already on the tag. `main` was therefore a strict ancestor of
  the published tag, so this reconcile is a clean fast-forward — no main-only commits
  needed re-applying and no history was lost. Version bumped 0.4.4 → 0.4.5 so `main`
  now sits at / above the published line. No functional code changes in this release.
