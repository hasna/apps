# @hasna/domains

## 0.0.47

### Patch Changes

- Updated dependencies [2a65f40]
  - @hasna/contracts@0.14.2

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
