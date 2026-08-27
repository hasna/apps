# Changelog

## 0.3.18

### Patch Changes

- Switch local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/files` data root (with the `HASNA_FILES_DATA_DIR` / `FILES_DATA_DIR` and `HASNA_FILES_HOME` / `FILES_HOME` exact-app overrides) stays the effective data root until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The SQLite store (`files.db`), `config.json`, the Google Drive connector token store, the ops-loop snapshot root, and the postinstall data-dir provisioning all resolve through the effective data root, and the one-time `~/.files` auto-migration now targets the effective root. The dependency is pinned exactly to `@hasna/paths@0.1.0` — the wave-wide pin for the hasna/apps resolver-switch lanes (XDG home migration, hotfixes plan 0f49f56a, task P3.3).


## 0.3.17

### Patch Changes

- a42a4ab: Port the read-side MCP tools to the hosted /v1 transport: `download_file`, `get_file_content`, `extract_file_text`, `extract_file_snapshot`, `describe_file`, and `get_file_url` now route through the hosted routes in api mode (GET /v1/files/:id/content, POST /v1/files/:id/extract-text, plus a new POST /v1/files/:id/sign-download server route for server-signed download URLs). The 20 write/ingest/mechanism-local tools keep the on-box-only guard with a documented refusal in api mode; both halves are locked by behavior tests (task c4459d0c, local-only-capability triage wave 1).
- Updated dependencies [b630c48]
  - @hasna/events@0.1.16
- Bound hosted content reads to the requested byte limit: `get_file_content`
  and `describe_file` now pass `max_bytes` to the server, the content route
  clamps it server-side, and `describe_file` previews are capped at 256 KiB —
  a reachable large remote file can no longer exhaust network or process
  resources (release-gate review finding, 2026-08-21).

## 0.3.16 — 2026-08-09

- Preserve combined local `source` and `tag` filtering by binding SQLite JOIN
  parameters before WHERE parameters, matching the generated SQL placeholder
  order without changing sorting, pagination, or the other list filters.
- Add store and CLI regressions with known-positive and absent-tag controls,
  covering both local and hosted list paths.

## 0.3.15 — 2026-08-09

Release of the immutable evidence authority and hosted lineage hardening merged
in #40 and #41.

- Make Files the immutable bytes-and-SHA-256 authority for evidence assets,
  including versioned provenance, retention and classification metadata,
  private download grants, and auditable access events across local and hosted
  stores.
- Bind hosted evidence ownership to the authenticated API-key tenant so
  cross-organization list, read, link, sign, verify, and upload-completion
  requests fail without exposing another tenant's assets.
- Publish all nine evidence-authority operations in OpenAPI and the generated
  `FilesClient`, covering upload intents, completion, asset reads and listing,
  links, private download grants, verification, and access events.
- Make concurrent requests with the same evidence idempotency key converge on
  the same asset and upload intent instead of surfacing a unique-index error.
- Quarantine ambiguous legacy hosted file lineage rather than binding an API
  key when tenant reconstruction is not unique.

## 0.3.13 — 2026-08-09

Release of the complete PostgreSQL migration-lineage compatibility repair
merged in #37.

- Restore the exact historical `files-0113` through `files-0154` migration
  lineage, including the four tenancy-bridge migrations.
- Append the `required_headers` scrub as `files-0155` without renumbering or
  rewriting historical migrations.
- Preserve downgrade and checksum-drift guards while restoring compatibility
  with the complete production migration ledger.

## 0.3.12 — 2026-08-09

- Preserve the `files list` JSON-array contract while fulfilling logical
  limits above the hosted API's 500-row per-request bound through internal
  pagination. A requested 1,000 rows can no longer return 500 at exit 0 with
  no indication that the result was truncated.
- Preserve caller offsets across internal pages and stop when the service
  returns a short page, without adding unnecessary requests for limits already
  within the server contract.

## 0.3.11 — 2026-08-08

Release of the hosted extension-filter normalization fix merged in #34.

- Accept extension filters with or without a leading dot in hosted list and
  metadata-search requests.
- Normalize extension filters to lowercase so values such as `PDF` match the
  canonical stored `.pdf` extension.

## 0.3.10 — 2026-08-08

Release of the PostgreSQL migration compatibility fix merged in #32.

- Restore the exact historical `files-0113` migration so databases that
  already applied it are recognized by the migration ledger.
- Preserve checksum-drift and unknown-migration downgrade guards without
  renumbering any existing migration.

## 0.3.9 — 2026-08-08

Release of the hosted content retrieval and event-loop isolation fixes merged
in #29 and #30.

- Add authenticated, tenant-scoped hosted routes for raw file bytes and derived
  text extraction.
- Make hosted CLI downloads and extraction write create-only, owner-mode output
  files while refusing stdout, symlinks, collisions, and tenant mismatches.
- Run hosted extraction and caller-supplied redaction patterns in a bounded
  worker so pathological regular expressions cannot monopolize the shared
  server request loop, while preserving existing redaction and private-output
  behavior.

## 0.3.8 — 2026-08-07

Release of the page-limit fix merged in #26.

- `files list` / `files search` no longer silently truncate a page. Requesting a
  limit above the 500-row cap previously returned 500 rows with no cursor, no
  total and no warning — a bounded read indistinguishable from a complete one.
  It now returns a structured `400` carrying `max_limit`, `requested_limit` and
  offset guidance. The cap itself is unchanged at 500; under-cap limits reach
  SQL verbatim.
- `files search --scope content` over the API is now refused explicitly instead
  of returning an empty list, so "no matches" and "content scope is unavailable
  here" are no longer indistinguishable. Cloud results carry
  `search_match_sources: ["metadata"]` so metadata-only coverage is visible.
- Closed a path that let a non-integer limit reach SQL.

The new `400` cannot degrade back into a silent empty result: the contracts
transport wraps non-2xx responses in `HasnaHttpError`, so callers raise rather
than receive a zero-length list.

## 0.3.7 — 2026-07-24

Security hardening for `files-serve`:

- Remove wildcard `Access-Control-Allow-Origin: *` from all REST JSON responses
  and the `OPTIONS` preflight. Browser requests are now allowed only when the
  `Origin` matches the request's own origin, an exact entry in
  `OPEN_FILES_REST_ALLOWED_ORIGINS` (comma-separated), or when
  `OPEN_FILES_REST_ALLOW_ANY_ORIGIN` is explicitly set. Disallowed origins get a
  `403 Origin not allowed` and no CORS headers; non-browser clients (no `Origin`
  header) are unaffected.
- Bind `files-serve` to `127.0.0.1` by default; `OPEN_FILES_REST_HOST` is the
  explicit override for non-loopback operator deployments.
- Add browser-origin regression tests for arbitrary remote origins, unconfigured
  loopback origins, configured origins, same-origin requests, non-browser
  clients, and preflight.

## 0.3.6 — 2026-07-24

Reconciliation release. Realigns `main` with the published npm line (`@hasna/files@0.3.5`,
git tag `npm/files/v0.3.5`), whose code had been shipped to the registry ahead of `main`
(which still read `0.2.49`). `main` was a strict ancestor of the published tag with **zero**
`main`-only commits, so this brings the 11 published commits onto `main` without dropping or
rewriting any history, then bumps the version above the published `0.3.5` so the next release
does not collide with the registry.

Published commits now reflected on `main` (0.2.49 → 0.3.5 line):

- feat(mcp): route files MCP reads/writes to cloud in self_hosted mode
- build(dist): bundle @hasna/contracts + mcp-harness into cli/mcp for self-contained fleet tarball
- refactor(store): route CLI + MCP data plane through a single Store seam
- fix(mcp): route every MCP tool through the Store seam
- fix(mcp): route agent registry + activity through the Store seam
- fix(store): close evidence + organization split-brain via the Store seam
- fix(store,cli,mcp): truthful api-mode deletes, graceful errors, on-box byte-resolution guards
- fix(cli,mcp,store): drop broken /machines/current preflight from source create+list
- chore: bump to 0.3.3
- fix(cli,evidence): guard context/search packs to on-box mode + persist local evidence root
- fix(cli): bound ops db-integrity with wall-clock budget + per-DB busy_timeout

Not included (left on `flip/mcp-cloud-routing` for separate review, **not dropped**): 4
post-0.3.5 unreleased commits (evidence/S3 presign header signing, cloud 404 guards, docker
dev-dep tolerance, cloud `/v1/files/recent` 404 guard).
