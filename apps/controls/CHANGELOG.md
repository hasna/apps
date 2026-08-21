# @hasna/controls

## 0.1.2

### Patch Changes

- d7d615b: Align hasna.contract.json kitVersion to the declared contracts kit 0.13.1 (the pinned @hasna/contracts version). Todos d175d558.
- Release hardening (release-review remediation): upgrade the contracts toolchain to @hasna/contracts 0.13.3 — regenerated storage kit, upgraded manifest (service surfaces, storage engines + live-Postgres gate, packed-artifact scan wired into prepack), and repo-conformance now all-pass. The parity test's fixture identity is a per-run random value instead of a committed literal; APP_VERSION and the OpenAPI document are synced to 0.1.2; the internal vault-ref path is removed from the exported config JSDoc.

## 0.1.1

### Patch Changes

- 0d4f749: Add `prepack: bun run build` so `npm pack` and `npm publish` ship the built `dist` that each package's `main` points to. Previously only `prepublishOnly` built, so a clean-clone `npm pack` shipped a tarball with no code. Also add a repo-root `.editorconfig` with the member-standard style (2-space indent, LF, final newline).
