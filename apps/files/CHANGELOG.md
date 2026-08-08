# Changelog

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
