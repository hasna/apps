# Changelog

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
