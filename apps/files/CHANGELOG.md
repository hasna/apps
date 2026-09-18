# Changelog

## 0.5.0

### Minor Changes

- 1f9e897: Add an explicit token-bounded page contract without breaking existing Files JSON consumers. `files list --json`, `files search --json`, `list_files`, and `search_files` preserve their historical full bare-array defaults. CLI callers opt into compact receipts with `--agent-json`; MCP callers use `format: "page"`. CLI page-only controls, including explicit `--detail compact`, reject unless `--agent-json` is selected, and compact detail is defaulted only after that mode selection. Page mode provides truthful continuation, byte-budget receipts, allowlisted fields, explicit full page detail, and a 500-row page cap.

  Add bounded exhaustive reads through CLI `--all` and MCP `all: true`. Exhaustive mode requires the receipt-bearing compact contract, starts at offset zero, walks bounded service pages, and refuses if the whole query exceeds 5,000 rows or 1 MiB. `_meta.end_reached` reports tail status; `_meta.complete` is true only when the response covers the whole query from offset zero.

  Keep the minimal/standard/full MCP profiles, capability and transport filtering, exact `get_file` path, hosted `/v1` authority behavior, and fail-closed local-store boundary. Hosted context-pack remains unavailable pending an owned tenant-scoped, revision-aware service contract. Local search continues to scan filtered candidates to true exhaustion with deterministic rank/id ordering.

- 66e3138: Resolve the app home to `~/.hasna/files` on every platform, per the 2026-09-04
  home-layout ruling.

  `apps/files` carried a private fork of the deleted `@hasna/paths`
  (hasna/apps#1535) in `src/lib/paths.ts` and again in `scripts/ensure-data-dir.mjs`.
  It resolved an XDG / macOS layout — `~/.local/share/hasna/files` on Linux,
  `~/Library/Application Support/Hasna/files` on macOS — labelled `~/.hasna/files`
  "legacy (pre-XDG)", and preferred the XDG root over it. The ruling makes
  `~/.hasna/<app>` the only canonical home, so the fork is removed.

  The silent adoption rule is removed with it. The data root used to switch to the
  XDG path merely because a `files.db` already existed there, which relocated a
  station's home with no operator intent and let a local SQLite artefact select
  live behaviour. Local SQLite remains supported only under the explicit
  `HASNA_FILES_LOCAL=1` opt-in; its mere presence never selects the transport or
  home.

  Overrides are unchanged in spirit and now the only way the home moves:
  `HASNA_FILES_DATA_DIR` / `FILES_DATA_DIR` / `HASNA_FILES_HOME` / `FILES_HOME`
  name the data root directly when absolute; `HASNA_DATA_HOME` relocates it to
  `<HASNA_DATA_HOME>/files`; `HASNA_HOME` relocates the `~/.hasna` root.
  `HASNA_CONFIG_HOME`, `HASNA_STATE_HOME` and `HASNA_CACHE_HOME` never move the
  data root. Relative or whitespace home/data-root overrides are treated as unset
  rather than resolved against the working directory.

  The postinstall script no longer creates an XDG directory at install time.
  Runtime and postinstall root selection are covered by one parity matrix.

  **Upgrade note.** A station that had adopted the XDG root implicitly — data at
  `~/.local/share/hasna/files` or `~/Library/Application Support/Hasna/files` with
  `HASNA_DATA_HOME` unset — will now resolve `~/.hasna/files` instead. Nothing is
  moved or deleted. If the canonical database is absent, explicit local startup
  refuses with `FILES_STRANDED_XDG_DATA` rather than creating an empty database
  beside the old one. Stop Files processes and back up both roots, then either set
  `HASNA_FILES_DATA_DIR` to the retained root or perform an offline migration that
  preserves the database, WAL/SHM state, configuration, and other root contents.
  Explicitly selected data roots remain authoritative and are not silently
  redirected by unrelated retired data.

- 16e80df: Serve the knowledge-source manifest from the authenticated Files `/v1` API.

  `files knowledge manifest` and the MCP `export_knowledge_manifest` now use
  `GET /v1/knowledge/manifest` when the hosted transport is selected. The service
  assigns every manifest-visible file, tag, project, collection, revision,
  extraction, and source mutation a transaction-serialized global change cursor.
  It persists privacy-minimized immutable snapshots so pages remain pinned to one
  high watermark even while later writes commit.

  Hosted page and checkpoint cursors are signed, versioned, tenant-bound, and
  query-bound. They use lossless decimal strings and are deliberately distinct
  from local per-file `sync_version` cursors. Hosted `since_sync_version` is
  refused; use the signed `since_cursor`. Filtered deltas are also refused until a
  separate membership-exit tombstone contract exists, while filtered full
  snapshots remain available.

  Every hosted manifest read resolves the authenticated API key's tenant before
  querying and applies that tenant to the watermark and immutable snapshot scan.
  The hosted projection omits station identity, local/source paths, S3
  bucket/prefix/region/object keys, and hashes derived from those coordinates.
  Extraction is reported available only when a tenant-bound materialized
  extraction matches the current revision; MIME capability alone is not evidence.
  Current-revision partial extractions preserve the `partial` status while
  remaining readable with an explicit extraction reference; stale-revision
  partial rows remain unavailable.

  OpenAPI now defines the complete query, success, item, cursor, and refusal
  schemas, and the generated SDK returns the typed manifest contract. CLI and MCP
  clients reject malformed or unattested 2xx responses. Hosted filter evidence is
  a closed typed object and must exactly attest the requested source, project,
  collection, tag, status, time, and delta selection on every page. Runtime
  validation also enforces every required field, closed source/status enums,
  nonblank identifiers and cursors, typed nonblank hashes, strict RFC 3339
  timestamps, and rejects unknown or sensitive response fields. Existing local
  manifest behavior, compact Files output, MCP profiles, canonical Files home, fresh
  credential resolution, and `https://api.hasna.com/files` plus one
  client-appended `/v1` remain unchanged.

  `include_acl_summary` and `include_evidence_assets` continue to refuse rather
  than fabricating empty data. Hosted S3 manifest artifacts remain unavailable;
  a local `--out` / `output_local_path` artifact is still supported.

- 46a5a48: Serve knowledge-source resolve, doctor, extracted-text, and snapshot reads over the authenticated Files `/v1` API without opening local SQLite. Hosted revision refs fail closed until an exact revision-aware byte route exists, so current bytes are never labeled as an older revision. Direct hosted snapshot commands also bind the extraction response to the exact requested file before framing success. MIME policy is shared across content, extraction, snapshots, and signed downloads; hosted doctor readiness requires a bounded extraction; `status=all` is exact; signed downloads require read scope. Snapshot framing is isolated in a pure module with no SQLite, AWS, filesystem, credential, or network imports.

  Deploy the updated `files-serve` before publishing this client release because hosted doctor depends on exact `status=all` semantics and read-scoped signing.

### Patch Changes

- d39db56: Reject truncated or size-mismatched hosted downloads before committing the output. The content service now reports the expected object size on full reads, and the streaming client cancels failed reads and reports its actual byte count.
- 17b86d8: Normalize hosted knowledge-manifest snapshot timestamps to strict RFC 3339 for existing and future rows, and execute the owner-managed global cursor capture through a fixed-search-path security-definer function so runtime file mutations remain authorized.
- 6728edc: Remove operational skill content from the public repository and package assets. Keep Skills catalogs and payloads in operator-owned storage, retire static selections and implicit legacy source imports, and reject tracked skill payloads in CI. Instructions no longer reloads a bundled or working-directory inbox contract by default. Project recommendations use the owner's skill tags rather than a shipped list of skill names.

## 0.4.1

### Patch Changes

- 9f8653f: Resolver validation fixes, round 3 (hasna/apps#1720, station03 release verification of 0.4.0): every declared bin now answers `--version` / `-V` and `--help` / `-h` from argv alone, before the credential gate and before any port is probed or bound. `files-mcp --version` on 0.4.0 ignored the flag and bound Streamable HTTP on 127.0.0.1, because the code served HTTP unless `--stdio` was passed while `--help` and the README promised stdio by default — stdio is now the default (the fleet convention), Streamable HTTP is the opt-in (`--http` / `MCP_HTTP=1`, with an explicit `--stdio` always winning), and the help text lists `--stdio` and `--version`. `files-serve --version` no longer probes and binds 127.0.0.1:19432 first, and `files-migrate --version` no longer exits 1 on a missing `HASNA_FILES_DATABASE_URL`. The fail-closed startup gate is unchanged: with no credential the MCP server still exits non-zero before the stdio transport connects or the HTTP port binds, never answers `initialize`, the first stderr line names where the credential should live (the Keychain item, the credentials-file path, `HASNA_FILES_API_KEY`), and nothing is created under the app home. The spawned startup tests now pin `HASNA_STATION` to a sentinel account so they stay hermetic on a Mac whose login keychain holds `hasna.credentials.files.api-key`.
- 6aa3917: `createFilesClientFromEnv` refuses loudly when a caller pins an explicit
  `baseUrl` without an explicit `apiKey` (hasna/apps#1720, adversarial
  credential-seam audit). Before, that combination silently built an
  UNAUTHENTICATED `FilesClient` pointed at the named authority: the ambient
  fleet key was correctly never attached, but the caller was left with a client
  that looks like a fleet client and sends no credential at all. The factory
  now throws `FILES_CREDENTIAL_PINNED` BEFORE any resolver tier is read and
  before any request can go out, naming the expected env sources
  (`HASNA_FILES_API_URL` / `HASNA_FILES_API_KEY`) and never carrying a key
  value.

  CONSUMER-VISIBLE BEHAVIOR CHANGE for the public `@hasna/files/sdk`: a call
  that previously returned an (unauthenticated) client now throws. A blank key
  is not a pin — `apiKey: ""` or a whitespace-only value, the shape a
  set-but-blank `.env` variable takes, refuses exactly like a missing key, so
  the unauthenticated path is closed rather than merely narrowed. For a pinned
  authority the key may be supplied either as the top-level `apiKey` or as
  `credentials: { apiKey }` — the same tier-1 shapes the sibling
  `@hasna/secrets` SDK accepts — so a caller who pins the key in either slot is
  not falsely refused. WITHOUT an explicit `baseUrl` both slots behave exactly
  as they did before this release: the top-level `apiKey` is the client-option
  pin, and `credentials.apiKey` stays a resolver tier-1 input that resolves the
  authority and the credential together (never a bare pin the constructor would
  reject). The explicit `baseUrl` + explicit `apiKey` pin and the from-env chain
  path keep working unchanged; the regression suite pins all of these shapes.

- 06f2b86: Switch @hasna/files local path reads/writes through the in-package resolver (XDG/macOS home layout). The legacy `~/.hasna/files` data root (with the `HASNA_FILES_DATA_DIR` / `FILES_DATA_DIR` and `HASNA_FILES_HOME` / `FILES_HOME` exact-app overrides) stays the effective data root until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The SQLite store (`files.db`), `config.json`, the Google Drive connector token store, the ops-loop snapshot root, and the postinstall data-dir provisioning all resolve through the effective data root, and the one-time `~/.files` auto-migration now targets the effective root. The wave-wide resolver dependency (`@hasna/paths@0.1.0`) was deleted 2026-09-03 (hasna/apps#1535); the resolver is now implemented locally in-package.
- 73a98fa: Record the strong reason for the organization local-transport guard (local-only-capability-removal workflow 2026-08-18): organization reviews operate on Google-Drive-imported metadata that only exists on-box; the hosted server has no schema, routes, or producer for that data plane. Gate comments now carry the dated evidence chain, and a behavior-lock test asserts the api-mode refusal fires with the documented reason. No runtime behavior change.

## 0.4.0

### Minor Changes

- 83e86a2: Resolve credentials through the `@hasna/contracts` client chain (hasna/apps#1720).

  The CLI, the MCP server and the `./sdk` client no longer carry a credential
  chain of their own. All three call the one resolver in `@hasna/contracts`
  (pinned to 1.0.2), which reads, per call: an explicit `--api-key`/`--profile`,
  then `HASNA_FILES_API_KEY_OVERRIDE` / `HASNA_PROFILE` /
  `HASNA_FILES_API_KEY_REF`, then the macOS Keychain item
  `hasna.credentials.files.api-key`, then `~/.hasna/files/config/credentials`
  (owner-only 0400/0600), then `HASNA_FILES_API_KEY`. The authority follows the
  same ladder — `HASNA_FILES_API_URL`, the Keychain `api-url` item, the
  credentials file — and now DEFAULTS to the fleet gateway
  `https://api.hasna.com/files` once a credential resolves, so a key alone is a
  complete configuration. The `./sdk` no longer needs a private env read either:
  `createFilesClientFromEnv` builds a client through the same chain, resolving
  the credential fresh on EVERY request, so a client held for hours picks up a
  key rotation without being rebuilt. The unprefixed `FILES_API_URL` /
  `FILES_API_KEY` names survive only as a silent resolver alias for one release;
  the canonical `HASNA_FILES_*` names always win.

  What this removes:

  - The home-grown transport selection (`HASNA_FILES_API_URL` +
    `HASNA_FILES_API_KEY` pair checks, alias precedence, half-configured-pair
    refusals) that `resolveFilesCloudStorage` layered on top of the resolver,
    together with the store's process-lifetime memoization — the store now
    resolves fresh per call, so a long-lived MCP server or agent loop picks up a
    rotation without a restart.
  - The `HASNA_FILES_LOCAL_MODE` / `FILES_LOCAL_MODE` switches. The on-box
    SQLite store is reachable only through the explicit opt-in
    `HASNA_FILES_LOCAL=1` (alias `FILES_LOCAL=1`), and every local run now
    prints one `files: LOCAL mode — ...` line on stderr so an unhosted run is
    never mistaken for an empty hosted one. `*_STORAGE_MODE` was already read
    nowhere and is gone from the tests.
  - The retired paths, which the resolver no longer consults either:
    `~/.hasna/fleet-env`, `~/.hasna/cloud`, `~/.config/hasna` and
    `$XDG_CONFIG_HOME`. No `~/.files/config.json` key store was ever read.
  - The legacy-env DEPRECATED stderr notice, which @hasna/contracts 1.0.2
    drops: `HASNA_FILES_API_KEY` is a legitimate tier, it just sits below disk.

  What this adds:

  - `@hasna/files/sdk` exports `createFilesClientFromEnv`, `FILES_APP_NAME` and
    `resolveFilesSdkTransport` (the transport report: which tier and source
    supplied the credential, never the value). An explicit `baseUrl` with an
    `apiKey` is a deliberate caller-owned pin; a `baseUrl` with NO `apiKey`
    never receives the ambient fleet key (hasna/apps#1794).
  - `src/store/client-types.ts` keeps the published `.d.ts` free of
    `@hasna/contracts` imports (#1782): crossing shapes are spelled locally and
    pinned to the real declarations, in both directions, by
    `src/store/client-types.test.ts`.
  - Hermetic credential tests (fake `HOME`/`HASNA_HOME`, injected `security`
    runner): env tier, disk tier, Keychain tier, per-request rotation
    freshness, fail-closed, and the transport report.

  Behaviour worth knowing about:

  - Hosted mode with no credential still fails closed — non-zero exit, no
    SQLite fallback, no local-fallback event — and the message now names every
    tier the resolver consulted, so the remedy is in the error. The `./sdk`
    factory throws in that case too.
  - A credential with no URL used to be refused as a half-configured pair; it
    now resolves the fleet gateway. A declared-but-blank `*FILES_*` variable is
    normalised to absent at the files seam (helpers in the wild blank rather
    than delete), and the Keychain tier's ambient gate is carried across that
    normalisation as `keychain.enabled`, so a station with a Keychain item is
    never silently dropped to the disk tier (hasna/apps#1788).

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
