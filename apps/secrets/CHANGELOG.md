# Changelog

## 0.3.2

### Patch Changes

- 0d4f749: Add `prepack: bun run build` so `npm pack` and `npm publish` ship the built `dist` that each package's `main` points to. Previously only `prepublishOnly` built, so a clean-clone `npm pack` shipped a tarball with no code. Also add a repo-root `.editorconfig` with the member-standard style (2-space indent, LF, final newline).
- ca7acc8: Emit a machine-readable stderr notice naming the local-vault fallback when no hosted API config (API_URL + API_KEY) is present, instead of a silent rc=0 "Vault is empty." — names the fallback path, the local secret count, and that hosted secrets are not visible (incident 715558, BUG b76e2d56).
- 4e5b690: fix(secrets): package_registry_token requires a value-shaped npm_ suffix, not a bare prefix
  
  The detector matched `npm_` followed by 12+ of `[A-Za-z0-9_]`, so npm's documented
  env var NAMES (`npm_lifecycle_event`, `npm_package_name`, ...) tripped
  `secrets scan staged` at rc=1 and blocked commits on files that only reference
  the names (bug 2693dbc4). The pattern now requires the value shape — `npm_` plus
  20+ alphanumeric characters with no underscore — which is the fleet's established
  value/name discriminator, applied consistently to the scanner detector and the
  history-scan git-grep pattern. Regression tests cover both directions: env var
  names pass, a value-shaped npm_ token still trips.
- 28fedae: fix(secrets): xai_api_key detector requires a value-shaped suffix, not a bare 'xai-' prefix
  
  The detector matched `xai-` followed by 12+ of `[A-Za-z0-9_-]`, so ordinary xAI
  model ids (a hyphenated word after the prefix) tripped `secrets scan` at rc=1
  and blocked commits on files containing no credential (bug a869386e, incident
  715866). The pattern now matches the vendor's published shape
  (xai-org/xai-proto `.gitleaks.toml`): `xai-` plus 20-80 alphanumeric
  characters. Applied consistently to the scanner detector, the history-scan
  git-grep pattern, and the redaction token mask. Regression tests cover both
  directions: model ids pass, a value-shaped key still trips.

## 0.3.1

### Patch Changes

- 8de5bb5: Release-line reconciliation: main is bumped to the registry-latest 0.3.0 (published by the release lane 2026-08-14 ahead of main). No functional changes — this patch establishes main/registry parity and clears the KNOWN_NPM_DRIFT and changelog-mismatch records (reconcile task 3ab02291).
- Updated dependencies [b630c48]
  - @hasna/events@0.1.16

## 0.3.0 — 2026-08-14

- Release-line reconciliation: main is bumped to the registry-latest 0.3.0 (published by the release lane 2026-08-14T14:23:49Z ahead of main; the release commit did not land on main). No functional changes to the tree; this entry records the version parity and clears the KNOWN_NPM_DRIFT and changelog-mismatch records (reconcile task 3ab02291).

## 0.2.22 — 2026-08-15

## 0.2.21 — 2026-08-10

- Add `secrets scan input [path|-]`, a bounded input/stdin scan mode so tool
  output can be scanned for credential exposures before it is persisted. Reuses
  the existing redacting detector engine and the staged gate's three-way exit
  contract: 0 read it all and found nothing, 1 found something, 2 could not read
  it all. `stdin` and `text` resolve to it as aliases. Over-bound input records a
  skip and returns 2 rather than a false clean.

## 0.2.20 — 2026-08-09

- Resolve account-scoped `--env` selectors through paged AWS metadata using
  canonical provider paths, with exact-name compatibility and fail-closed
  handling for missing, ambiguous, non-current, or non-string secrets.

## 0.2.19 — 2026-08-09

- Add account-scoped `secrets exec --provider ... --account ... --env ...`
  consumption through standard AWS profiles while preserving legacy key/`--as`
  execution.

## 0.2.18 — 2026-08-08

- Require a left boundary before OpenAI secret-key matches so task-first slugs
  like `OPE45-00025-openai-key-boundary` are not reported as credential leaks.

## 0.2.17 — 2026-08-08

- Reject unsupported `secrets scan` flags instead of silently scanning the
  current workspace.
- Return a nonzero exit when workspace or history scans report errors, while
  preserving redacted JSON evidence and successful directory scans.

## 0.2.16 — 2026-08-08

- Reconcile production tenant-migration lineage through schema verification
  and an idempotent backfill while keeping unknown checksum drift fatal.
- Bind cloud writes to persisted tenant assignments and reject unassigned
  credentials before mutation, including concurrent and post-backfill writes.

## 0.2.15 — 2026-08-08

- Preserve schema-proven compatibility for the legacy checksum of
  `secrets_0010_tenant_columns` when all expected tenant columns and Postgres
  types are present; unknown checksum drift remains fatal.

## 0.2.14 — 2026-08-08

- Restored the production migration lineage for `secrets_0008_tenants`, so
  deployments recognize the already-applied tenants migration.
