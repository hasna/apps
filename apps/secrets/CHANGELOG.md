# Changelog

## 0.3.13

### Patch Changes

- Local vault path reads/writes now resolve through the `@hasna/paths` resolver (XDG/macOS home layout) with gated legacy adoption: `~/.hasna/secrets` stays the effective data home until the store is migrated to `~/.local/share/hasna/secrets` or `HASNA_DATA_HOME` is set (XDG home migration, hotfixes plan 0f49f56a, task P3.3). The `~/.secrets` env-file bridge is unchanged. Pins `@hasna/paths@0.1.0`.

## 0.3.10

### Patch Changes

- `secrets copy` — value-safe copy verb: copies a secret from one key to another without ever rendering the value (A18-00021/26/27, PR #1070, review GO).

## 0.3.9

### Patch Changes

- `secrets scan input` now scans every named path; exit code is the max severity across all inputs (AGE10-00616). 0.3.8 was published with a stale version literal (version.ts still said 0.3.7; unpublish blocked for the granular token); 0.3.9 ships the same scan-input fix with the version literal corrected.

## 0.3.8

### Patch Changes

- `secrets scan input` now scans every named path; exit code is the max severity across all inputs (AGE10-00616). Superseded by 0.3.9 (stale version literal corrected).

## 0.3.7

### Patch Changes

- 4af006f: secrets, secrets-mcp, and secrets-serve answer --version/--help cleanly before any store resolution, transport connect, or bind (todos row afd9e358). Previously `secrets --version` exited rc=1 with "Unknown command: --version", `secrets-mcp --version` entered MCP stdio mode, printed nothing, and exited rc=0 silently when stdin closed, and `secrets-serve --version` fell through to the cloud-server boot path (master-key refusal rc=1, or bind-and-serve forever). The `secrets-serve db` subcommand is covered too: `db --help`/`db --version` answer before the db path opens the cloud pool or runs `ledger.migrate()` (cycle-1 remediation, hasna/apps review O15-00517).

## 0.3.6

### Patch Changes

- ae4567b: `secrets-serve` wires the strict `keyStatus` key-status hook instead of the deprecated `isRevoked`-only hook, so the /v1 verifier constructs under `@hasna/contracts` 0.13.4 and a validly-signed API key with no `api_keys` record is refused.

  `@hasna/contracts` >= 0.8.7 (contracts #62) refuses `isRevoked`-only wiring **eagerly at construction**, and `startCloudServer` builds the verifier during boot — so the throw took the whole service down rather than one route. `isRevoked` also cannot express the refusal that matters: it returns `false` both for an active key and for one that was never registered, which makes an unregistered key irrevocable. `keyStatus` denies anything other than `"active"` (`unknown`, `revoked`, `expired`).

  Same defect class as the `@hasna/calendar` 0.3.6 /v1 503 incident (row I38-00755, hasna/apps#967) and the `@hasna/todos` 0.15.38 one (row ae34a051, hasna/apps#769).

  The verifier construction is extracted from `startCloudServer` into an exported `createCloudVerifier(client, signingSecret)` so the real wiring is reachable from a test without opening a Postgres pool or running the version backfill. New `tests/serve-auth-wiring.test.ts` pins both halves: that the wiring constructs, and that unregistered, revoked and expired keys are all denied while a registered active key is allowed.

## 0.3.5

### Patch Changes

- 50473b8: fix: main CI recovery — regenerate per-app lockfiles after the #856/#923 version waves (frozen-lockfile class), repin projects' dependencies to the published conversations 0.7.4 / mementos 0.14.85 / todos 0.15.41 (the wave-pinned 0.7.5/0.14.86/0.15.43 were never published), sync recordings' Info.plist to 0.3.9 and secrets' runtime version literal to 0.3.5, and clear the publish-guard internal-infra string violations across connectors/emails/skills/secrets/telephony plus the guard's over-broad ARN/domain content patterns.

## 0.3.4

### Patch Changes

- d7d615b: Align hasna.contract.json kitVersion to the declared contracts kit 0.13.1 (the pinned @hasna/contracts version). Todos d175d558.

## 0.3.3

### Patch Changes

- b2638b2: fix(scanner): package*registry_token fires on npm* identifiers — align the tail threshold with the fleet-documented value-length standard ({12,} → {20,}, matching tooling/ci/check-secrets.ts and the commit-gate pattern history). The detector matched ordinary names (identifiers ending in packages*seen / global_duplicates) and blocked commits on credential-free files; real npm granular tokens (npm* + 36 hex) still fire. Regression tests cover both directions (todos 12ccb3a2).

## 0.3.2

### Patch Changes

- 0d4f749: Add `prepack: bun run build` so `npm pack` and `npm publish` ship the built `dist` that each package's `main` points to. Previously only `prepublishOnly` built, so a clean-clone `npm pack` shipped a tarball with no code. Also add a repo-root `.editorconfig` with the member-standard style (2-space indent, LF, final newline).
- ca7acc8: Emit a machine-readable stderr notice naming the local-vault fallback when no hosted API config (API_URL + API_KEY) is present, instead of a silent rc=0 "Vault is empty." — names the fallback path, the local secret count, and that hosted secrets are not visible (incident 715558, BUG b76e2d56).
- 4e5b690: fix(secrets): package*registry_token requires a value-shaped npm* suffix, not a bare prefix

  The detector matched `npm_` followed by 12+ of `[A-Za-z0-9_]`, so npm's documented
  env var NAMES (`npm_lifecycle_event`, `npm_package_name`, ...) tripped
  `secrets scan staged` at rc=1 and blocked commits on files that only reference
  the names (bug 2693dbc4). The pattern now requires the value shape — `npm_` plus
  20+ alphanumeric characters with no underscore — which is the fleet's established
  value/name discriminator, applied consistently to the scanner detector and the
  history-scan git-grep pattern. Regression tests cover both directions: env var
  names pass, a value-shaped npm\_ token still trips.

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
