# @hasna/domains

## 0.1.0

### Minor Changes

- 990c253: Resolve credentials through the `@hasna/contracts` 1.0.2 client chain
  (hasna/apps#1720).

  The CLI, the MCP server and the `./sdk` client no longer carry a credential
  chain of their own. All three call the one resolver in `@hasna/contracts`
  (pinned to 1.0.2), which reads, per call: an explicit `--api-key`/`--profile`,
  then `HASNA_DOMAINS_API_KEY_OVERRIDE` / `HASNA_PROFILE` /
  `HASNA_DOMAINS_API_KEY_REF`, then the macOS Keychain item
  `hasna.credentials.domains.api-key`, then `~/.hasna/domains/config/credentials`
  (owner-only 0400/0600), then `HASNA_DOMAINS_API_KEY`. The authority follows the
  same ladder — `HASNA_DOMAINS_API_URL`, the Keychain `api-url` item, the
  credentials file — and now DEFAULTS to the fleet gateway
  `https://api.hasna.com/domains` once a credential resolves, so a key alone is a
  complete configuration. Resolving per call is what makes a key rotation heal a
  long-lived shell, MCP server or agent without restarting it: the store's
  authenticated transport and the SDK re-resolve the credential on every request,
  so the next request after a rotation carries the new key. The two deliberate
  exceptions are an explicit `apiKey` argument (tier 1, a pin the caller owns)
  and the service authority, which is fixed for the life of a client so a
  credential written for one authority is never sent to another.

  What this removes (the app's own chain, class B):

  - The app's own client flip (`resolveClientFlip`), its test-run downgrade guard
    and its escape hatches (`HASNA_DOMAINS_ALLOW_CLOUD_IN_TESTS`,
    `HASNA_DOMAINS_TEST_GUARD`, `HASNA_DOMAINS_ALLOW_CLOUD_WITH_LOCAL_PATH`) —
    the shared resolver's env contract decides, and a local path set NEXT TO a
    configured authority/credential is a loud conflict in every runner.
  - The in-package reimplementation of the deleted `@hasna/paths` resolver, the
    XDG data/config home layout, `~/.config/hasna`, `$XDG_CONFIG_HOME`,
    `$XDG_DATA_HOME` and the one-time migrations from the pre-XDG layout. The
    local data home is `~/.hasna/domains` (or `$HASNA_HOME/domains`), exactly
    where the resolver's credential file lives.
  - The retired `*_MODE` / `*_STORAGE_MODE` switches, everywhere. Nothing in the
    package mentions them.
  - The unprefixed names no longer outrank the canonical pair: the app never
    reads `DOMAINS_API_URL` / `DOMAINS_API_KEY` itself, the resolver's
    silent-alias fallback is the only place they are accepted (one release), and
    the canonical `HASNA_DOMAINS_*` path names (DB path, dir, home, config path)
    always win over their legacy aliases.

  What this adds:

  - `getStoreResolution()` on the package entry and a transport report in
    `domains doctor`: which store resolved, WHERE the URL and key came from
    (env key NAME, Keychain reference, file PATH, or `"default"`), and WHICH tier
    supplied the key — never the key value.
  - Local mode is an explicit opt-in (a local path var, with no authority or
    credential configured in the environment) and every local run prints one
    `LOCAL mode` line on stderr.
  - `createDomainsClientFromEnv()` (`./sdk`) now accepts `profile` and `keychain`
    options, and a client built with an EXPLICIT `baseUrl` and no `apiKey` never
    attaches an ambient fleet key resolved against another authority
    (hasna/apps#1794).

  Behaviour worth knowing about:

  - Hosted mode with no credential still fails closed — non-zero exit, no SQLite
    fallback, no local-fallback event — and the message now names every tier it
    consulted, so the remedy is in the error.
  - `@hasna/contracts` moved to a devDependency: `bun build --target bun` inlines
    it into every shipped bundle, and the published `.d.ts` files are
    self-contained (they spell the crossing client types locally;
    hasna/apps#1782), so consumers install nothing extra.
  - A credential with no URL used to be refused as a half-configured pair; it now
    resolves the fleet gateway.
  - A declared-but-blank authority variable no longer disables the Keychain
    tier: removing a blank means handing the resolver a COPY of the environment,
    and `@hasna/contracts` gates its ambient tiers on object identity, so the
    gate is decided before normalising and carried across as `keychain.enabled`
    (hasna/apps#1788).

### Patch Changes

- 794c8c6: Resolver-validation polish for hasna/apps#1720 (P2 lane).

  - **CLI boundary reports a fail-closed refusal as one line.** An error that
    escapes a command action — the shared resolver's `domains fails closed: …`
    refusal naming the Keychain item, the credentials file and
    `HASNA_DOMAINS_API_KEY` — is now printed as a single stderr line with exit 1
    instead of a Bun source-context stack dump. Exit code, empty stdout and the
    message text are unchanged; only the presentation is.
  - **`domains-mcp` fails closed at startup.** The store decision is resolved
    once before any transport is connected or port bound (mirrors mementos
    #1868): with no resolvable credential and no explicit local opt-in the
    server exits 1 with the same one-line refusal instead of connecting stdio,
    printing its banner and refusing only at the first tool call. A local
    opt-in announces `LOCAL mode` on stderr at startup. Nothing is created
    under the app home on the refusal path.
  - **`domains-serve --help` / `-h` answers before the signing secret is
    resolved**, printing usage and exiting 0, the same way `--version` / `-V`
    already did; previously it died with "Missing API-key signing secret".
  - **Safe-mode allow-list:** the never-registered `storage_status` entry is
    removed from `READ_ONLY_TOOLS`, and a static test now pins that every
    allow-listed tool is registered by the MCP entry.
  - **Test hermeticity:** the subprocess store-resolution probes pin
    `HASNA_STATION` to a sentinel account so the ambient Keychain tier misses
    deterministically; on a provisioned station the real
    `hasna.credentials.domains.api-url` item previously contradicted the
    fixture authority and turned the CONTROL probe red.

## 0.0.47

### Patch Changes

- Switch @hasna/domains local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/domains` default (with the `HASNA_DOMAINS_HOME` / `DOMAINS_HOME` / `HASNA_DOMAINS_DIR` / `DOMAINS_DIR` exact-app overrides) stays the effective data home until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The dependency is pinned exactly to `@hasna/paths@0.1.0` (XDG home migration, hotfixes plan 0f49f56a, task P3.3).

## 0.0.46

### Patch Changes

- Updated dependencies [85a5e06]
  - @hasna/contracts@0.14.1

## 0.0.45

### Patch Changes

- Updated dependencies [6176948]
- Updated dependencies [7575de8]
  - @hasna/contracts@0.14.0

## 0.0.44

### Patch Changes

- 12662e9: domains-mcp answers --help/--version before any bind; previously `domains-mcp --version` (and `--help`) fell through past the isStdioMode check to the shared Streamable HTTP server (default port 8859) — with the port occupied it died EADDRINUSE rc=1 printing nothing, with the port free it bound and hung instead of answering (todos row 46a45765).

## 0.0.43

### Patch Changes

- Updated dependencies [554a5b9]
  - @hasna/contracts@0.13.4

## 0.0.42

### Patch Changes

- c71ce84: Move the canonical local data root to `~/.hasna/domains` (was `~/.local/share/open-domains`). The CLI, doctor, and server now read and write the canonical root; legacy installs continue using their existing data directory.
- 97594ff: Report already-lapsed domains in the CLI and stamp registrar sync freshness so expiry state is visible even when a sync has not run recently.
- d7d615b: Pin @hasna/contracts to the published 0.13.1 (was ^0.13.0; 0.13.0 is unpublished, which makes the standard-suite conformance validator cannot-run) and align hasna.contract.json kitVersion to the declared contracts kit 0.13.1. Todos d175d558.
- f5d44c4: Wire the recommended `keyStatus` hook (`ApiKeyStore.keyStatus` from @hasna/contracts/auth) into domains-serve's verifier, replacing the deprecated `isRevoked`-only wiring and the hook-less test construction (row 5eb0c0df). The contracts auth verifier fails closed at construction without a key-status hook, so the server suite's 10 app tests threw at build time. Tests now construct the app with a key-status resolver and add a regression proving a revoked key is denied through the hook.
- 9469090: Remove the dead 'cloud-http' transport token from the store wiring (row 0fdd8998). The removed-modes directive (owner 2026-07-29) retired the deployment-mode vocabulary and @hasna/contracts now resolves client transports as "sqlite" | "http"; the stale 'cloud-http' comparison made the member build fail with TS2367/TS2339 at src/db/store.ts:920/:926. The DomainsStore transport union, ApiStore constant, hosted-client check and the doctor banner now use "http", with a compile-time union regression in store.ts.
  - @hasna/contracts@0.13.3

## 0.0.41

### Patch Changes

- edf3cea: Migrate off the removed @hasna/contracts/mode subpath (owner directive 2026-07-29: no mode vocabulary) and onto the current client-storage transport token.
- Updated dependencies [5e32853]
  - @hasna/contracts@0.13.2

## 0.0.40

### Patch Changes

- 0d4f749: Add `prepack: bun run build` so `npm pack` and `npm publish` ship the built `dist` that each package's `main` points to. Previously only `prepublishOnly` built, so a clean-clone `npm pack` shipped a tarball with no code. Also add a repo-root `.editorconfig` with the member-standard style (2-space indent, LF, final newline).
- Updated dependencies [d5b64f8]
- Updated dependencies [1da0550]
  - @hasna/contracts@0.13.0
