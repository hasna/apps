# @hasna/sessions

## 0.12.17

### Patch Changes

- d7d615b: Pin @hasna/contracts to the published 0.13.1 (was ^0.13.0; 0.13.0 is unpublished, which makes the standard-suite conformance validator cannot-run) and align hasna.contract.json kitVersion to the declared contracts kit 0.13.1. Todos d175d558.
  - @hasna/contracts@0.13.3

## 0.12.16

### Patch Changes

- edf3cea: Migrate off the removed @hasna/contracts/mode subpath (owner directive 2026-07-29: no mode vocabulary) and onto the current client-storage transport token.
- Updated dependencies [5e32853]
  - @hasna/contracts@0.13.2

## 0.12.15

### Patch Changes

- 0d4f749: Add `prepack: bun run build` so `npm pack` and `npm publish` ship the built `dist` that each package's `main` points to. Previously only `prepublishOnly` built, so a clean-clone `npm pack` shipped a tarball with no code. Also add a repo-root `.editorconfig` with the member-standard style (2-space indent, LF, final newline).
- Updated dependencies [d5b64f8]
- Updated dependencies [1da0550]
  - @hasna/contracts@0.13.0

## 0.12.14

### Patch Changes

- 961579c: feat(sessions): serve recall, semantic/hybrid search, embed, recompute-machines, and import-db on the hosted /v1 backend (local-only capability removal). New server endpoints /v1/recall, /v1/search/semantic, /v1/search/hybrid, /v1/embed, /v1/machines/recompute, plus a Postgres embeddings table (migration 0007); the hosted store now calls them instead of throwing. `sessions ingest` remains a loud guard: it scans the machine's own transcript files, and on a hosted machine `sessions sync` provides ingest + push via /v1/sessions/import.
- Updated dependencies [b630c48]
  - @hasna/contracts@0.11.2
  - @hasna/events@0.1.16
