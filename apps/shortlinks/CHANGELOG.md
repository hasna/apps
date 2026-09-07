# Changelog

## 0.3.0

### Minor Changes

- 176802f: Adopt the @hasna/contracts 1.0.2 client credential resolver for every hosted
  surface (CLI, MCP server, and `./sdk`) (hasna/apps#1720).

  - `@hasna/contracts` is pinned to exact `1.0.2` (still build-time: `bun build
--target bun` inlines it, so consumers install nothing extra). The published
    `.d.ts` no longer imports `@hasna/contracts`: crossing types are spelled
    locally in `src/client-types.ts` and asserted against the real contracts
    declarations at compile time (hasna/apps#1782).
  - The app's own env chain is deleted. The resolver decides: the Keychain item
    `hasna.credentials.shortlinks.api-key` (macOS), the disk credential
    `~/.hasna/shortlinks/config/credentials` (0400/0600), or
    `HASNA_SHORTLINKS_API_KEY` (legacy alias `SHORTLINKS_API_KEY`), with the
    authority following `HASNA_SHORTLINKS_API_URL` or defaulting to the fleet
    gateway `https://api.hasna.com/shortlinks` — URLs never need configuring. A
    credential alone (any tier) selects the hosted `/v1` API, resolved fresh per
    request.
  - Fail-closed semantics (owner ruling 2026-09-04): hosted with no credential
    exits non-zero, creates no SQLite, and never emits a `*-local-fallback`
    event. Local mode is reachable ONLY by explicit opt-in
    (`HASNA_SHORTLINKS_LOCAL=1`, alias `SHORTLINKS_LOCAL`, or `--db <path>`) and
    announces "local" on stderr. A URL without a credential, a declared-but-blank
    variable, disagreeing authorities, or an unreadable credential file all
    throw.
  - Never hands @hasna/contracts a copied env object (hasna/apps#1788):
    declared-but-blank authority variables are normalised at the app seam, with
    the Keychain tier's ambient gate carried across the copy when one is forced.
  - SDK (#1794): an explicit `baseUrl` with no `apiKey` never attaches the
    ambient fleet key — the credential is pinned to the authority it resolved
    with. `createShortlinksApiClient` refreshes the credential on every request.
  - New hermetic tests (fake HOME/HASNA_HOME, injected `security` runner):
    credential resolution (env/disk/keychain/argument tiers), fail-closed
    guarantees, and the transport report.

### Patch Changes

- abefc15: Resolver validation fixes for the `@hasna/contracts` credential chain adoption
  (hasna/apps#1720, round-1 validator findings).

  - `shortlinks-mcp` fails closed at startup: with no shortlinks credential
    resolvable (Keychain item, `~/.hasna/shortlinks/config/credentials`,
    `HASNA_SHORTLINKS_API_KEY`) and no explicit `HASNA_SHORTLINKS_LOCAL=1`, the
    bin now exits non-zero naming the credential chain BEFORE any transport
    starts. Previously it announced "stdio ready" and exited 0 when stdin closed
    — a server whose every tool would have refused. Hosted startup touches
    nothing on disk; the explicit local opt-in announces local mode at startup
    and opens the on-box database in the caller's home.
  - `shortlinks-mcp --version` / `--help` and `shortlinks-serve --version` /
    `--help` answer on stdout with rc=0 without starting a transport, resolving a
    backend, or binding a port (they used to fall through to the stdio loop and
    the PostgreSQL pool factory respectively). The MCP server now reports the
    package version instead of a hard-coded `1.0.0`.
  - The app home is derived from the environment each surface was handed, never
    from a silent `process.env` read behind a caller-built env: `LocalStore`,
    `ShortlinksStore`, and every config/machine-id/click-salt helper take the
    env they were resolved with. A local opt-in test used to plant
    `~/.hasna/shortlinks/shortlinks.db` in the REAL home on every `bun test`
    (station no-local-SQLite rule); the suite now guards against that. Path
    lookups (`getConfigPath`, `getDatabasePath`) create nothing — only a write
    creates the app home — so a hosted-mode `doctor` or MCP startup leaves no
    directory behind. `HASNA_HOME` relocates the app home
    (`$HASNA_HOME/shortlinks`) exactly as it does for the credential chain.
  - Removed the stray `sdk/` scaffold that declared an unpublished
    `@hasna/shortlinks-sdk` split package (one package per app; the resolver-
    backed client ships at the `./sdk` export subpath). `bun run sdk:generate`
    writes `src/sdk/generated.ts` only.

## 0.2.10

### Patch Changes

- fix: make the shortlinks tarball publish-guard-clean and align the contracts pin. README and the Cloudflare example config no longer reference the internal `shortlinks.hasna.xyz` domain (packed content must carry no `.hasna.xyz` strings per the repo publish guard); the `@hasna/contracts` devDependency is pinned to the published `0.13.1` (the registry `0.13.3` carries the unsatisfiable peer `@hasna/secrets@0.3.4`, and the manifest/kitVersion already declare 0.13.1), with the root lockfile regenerated.

## 0.2.9

### Patch Changes

- d7d615b: Pin @hasna/contracts to the published 0.13.1 (was ^0.13.0; 0.13.0 is unpublished, which makes the standard-suite conformance validator cannot-run) and align hasna.contract.json kitVersion to the declared contracts kit 0.13.1. Todos d175d558.

## 0.2.8

### Patch Changes

- b5e05fd: CLI output projects signed capability destination URLs (S3/GCS presigned, CloudFront signed) to their plain unsigned reference — capability query parameters are stripped before any output surface (human, JSON, verbose, resolve, stats). Incident 716957 / todos b03cc058: a stored destination that was itself a presigned read URL was previously emitted verbatim into CLI output and reproduced in session transcripts, granting bearer read access until expiry.

## Unreleased

- ci: run install, typecheck, build, and tests for pull requests and pushes to
  `main`.

## 0.2.7

- feat(cli): compact human output by default across shortlinks-owned
  list/detail/status/setup commands (`link list/get`, `domain list/get/setup`,
  `stats`, `doctor`, `config show`, `cloudflare`, `local`). Long URLs/text are
  truncated, human rows are capped, and each command prints the next command to
  use for details. Machine output is unchanged: `--json` still returns full
  objects; `--verbose` prints the full object for human debugging; `--limit`
  controls row caps.
- feat(cli): bound external `domains` passthrough output (`domain check/buy`)
  by default; `--verbose`/`--json` still expose the full command output.
- feat(events): replace the generic `@hasna/events` command registration with
  shortlinks-owned compact wrappers so `events list` and `webhooks list` are
  capped by default (part of the fleet-wide compact-CLI-output initiative).
- test(cli): make the CLI test harness hermetic — neutralize any ambient cloud
  client-flip (`HASNA_SHORTLINKS_MODE`/`STORAGE_MODE` + `API_URL` + `API_KEY`)
  so `bun test` always exercises the on-box LocalStore and never touches the
  real shortlinks cloud API on a self_hosted-configured machine.

## 0.2.6

- chore(reconcile): reconcile `main` to the published npm line. `main` had
  fallen 7 commits behind the published release tag `npm/shortlinks/v0.2.5`
  (npm dist-tag `latest` = 0.2.5); the deployed/published code was never merged
  back to `main`. `main` was a strict ancestor of the tag (0 commits ahead), so
  the published work (`5003522`..`bdf5556`) was merged back non-destructively —
  no `main` commits lost, no force-push. Version bumped above the published
  line (published tag's package.json read 0.2.4 vs dist-tag 0.2.5 — a
  bump-vs-tag mismatch upstream; skipping 0.2.5 to avoid reuse).

## 0.2.1

- fix(mcp): remove the unpublished `@hasna/mcp-harness` (`file:../open-mcp`)
  dependency that made `shortlinks-mcp` unstartable on a fresh install. The MCP
  HTTP transport is now self-contained (published `@modelcontextprotocol/sdk` +
  Bun.serve), matching the reference apps.
- feat(domains): add domain deletion end-to-end — `shortlinks domain remove`
  CLI command, `delete_domain` MCP tool, `Store.deleteDomain`, and
  `DELETE /v1/domains/:hostname` API endpoint (cascades links + clicks).
  Requires an ECS redeploy of the self-hosted server for the new route.
- chore(deps): depend on the published `@hasna/contracts` instead of a `file:`
  link so `bun install` / `npm i` resolve cleanly.

## 0.1.0

- Initial CLI-only shortlinks package.
