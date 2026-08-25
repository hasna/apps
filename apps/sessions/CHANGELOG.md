# @hasna/sessions

## 0.12.21

### Patch Changes

- No code changes since 0.12.20. Mechanical version bump from the 2026-08-24 wave (#1168); the wave's `@hasna/contracts@0.14.1` dependency update was reverted by the repin (O15-00725, #1181) — dependencies are unchanged from 0.12.20.

## 0.12.20

### Patch Changes

- Updated dependencies [6176948]
- Updated dependencies [7575de8]
  - @hasna/contracts@0.14.0

## 0.12.19

### Patch Changes

- Updated dependencies [554a5b9]
  - @hasna/contracts@0.13.4

## 0.12.18

### Patch Changes

- fix(cloud-embeddings-schema): add migration 0008 so the shipped schema matches the /v1 code path. 0007 declared `embedding FLOAT8[]` / `synced_to_s3 INTEGER` but ran as a no-op on every database where 0001 had already created `embeddings` (BYTEA / BOOLEAN), so the cloud embed/semantic/hybrid/recall paths failed or misread against the shipped schema. 0008 ALTERs both columns and adds the two search indexes 0007 also no-oped on; a real-Postgres regression test asserts the applied schema and a vector round-trip (fails without 0008).
- fix(auth): wire the /v1 verifier to the @hasna/contracts 0.13.x API. `verifyApiKey` no longer accepts the boolean `isRevoked` hook alone: cloud mode now uses `keyStatus` (strict: unknown/revoked/expired keys are refused), and local mode declares `allowUnregisteredKeys: true` (the documented intent — local mode skips revocation). /v1 returned 500 in local mode before this fix.
- fix(tests): make CLI-spawning tests robust to fleet-machine environment contamination. BASH_ENV sources ~/.hasna/cloud/agent-env.sh into every non-interactive bash (re-exporting the real sessions cloud env), and the @hasna/contracts disk credential tier (~/.hasna/cloud/sessions.env) outranks legacy env keys; the test helpers now re-assert their local/mock environment in-command and deliver keys via the `HASNA_SESSIONS_API_KEY_OVERRIDE` tier.

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
