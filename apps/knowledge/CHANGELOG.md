# Changelog

## Unreleased — inventory paths block fix

Fix `knowledge inventory --json` reporting the wrong `paths` block in
self_hosted/cloud (api) mode, where it disagreed with `knowledge paths`.

- fix(knowledge): the `inventory` `paths` block now reflects the real on-box
  workspace layout (`json_store_path` = `workspace.jsonStorePath`,
  `json_store_exists` / `knowledge_db_exists` via read-only `existsSync`),
  matching `knowledge paths`. Previously `itemOnlyInventory()` echoed the cloud
  transport URL as `json_store_path` and hardcoded `knowledge_db_exists: false`.
  The cloud item-corpus source location is still surfaced via `legacy_store.path`.
- test(knowledge): `tests/cloud-inventory.test.ts` now asserts `inventory.paths`
  equals `service.paths()` for all four path fields, that the `/v1` URL never
  appears in the paths block, and that it is reported on `legacy_store.path`.
- Rebuilt generated bundles so shipped artifacts carry the fix and
  `verify:generated` passes.

## Unreleased — Search overhaul, Stage 2 (Postgres full-text parity)

Top-priority correctness fix: the hosted (cloud) notes list returned materially
different, near-empty results versus local. Brings cloud search to parity with
the local SQLite FTS behavior shipped in Stage 1 (#29).

- Replaced the `title/content ILIKE '%q%'` + `ORDER BY created_at DESC` cloud
  path (`NoteRepo.list`, `src/serve.ts`) with a weighted `tsvector` generated
  column (title = A, content = B) + GIN index (`src/db/pg-migrations.ts`),
  queried via `websearch_to_tsquery('english', …)` and ranked by `ts_rank_cd`
  (created_at as a deterministic tiebreak). Fixes the "cloud returns nothing"
  bug where multi-term / word-order-varying queries matched no substring and
  results were ordered by recency rather than relevance.
- Postgres migrations are **appended** to `PG_MIGRATIONS` (index-derived ids,
  never inserted mid-array) and are idempotent.
- Added an in-process Postgres (`@electric-sql/pglite`, devDependency) parity
  suite (`tests/search-pg-parity.test.ts`) running the real `NoteRepo` against
  the real migrations, asserting word-order independence, relevance-over-recency,
  phrase adjacency, `total` reflecting the FTS predicate, and sqlite-vs-pg
  equivalence over the shared corpus.

## 0.2.89

Harden public npm package contents so internal docs never ship. The published
package previously included the entire `docs/` and `scripts/` trees via broad
`files` entries, which packed `docs/canonical-secrets-bootstrap-2026-06-08.md`
(internal secret-path topology and account references) into the public tarball.

- Replace the broad `docs` and `scripts` entries in `package.json` `files` with an
  explicit allowlist of public guides and dev scripts; the internal
  secrets-bootstrap runbook is now excluded from the package.
- Add `scripts/validate-public-package.mjs` (`npm run release:pack:check`), a
  fail-closed check that diffs `npm pack --dry-run` against the allowlist and
  rejects any unreviewed or forbidden docs/scripts path. Wired into
  `prepublishOnly`.
- Add `tests/package-release.test.ts` (`bun run test:package`) asserting the
  allowlist and the packed manifest.
- Document the allowlist policy in `README.md` and `SECURITY.md`.

## 0.2.88

Security/hygiene: stop shipping the internal infra host `knowledge.hasna.xyz` as the
default hosted API URL in the published package. The default now resolves to the public
product domain `https://knowledge.md`.

- `DEFAULT_KNOWLEDGE_API_URL` (`src/auth.ts`), `defaultKnowledgeConfig()` hosted default
  (`src/workspace.ts`), the `normalizeMode` alias (`src/service.ts`), and doc comments in
  `src/cli.ts` / `src/cloud-store.ts` now use `knowledge.md` instead of the internal host.
- Propagated to README, `docs/examples`, `docs/migration`, and `tests/cloud-store.test.ts`.
- Rebuilt `dist/` and `bin/` (shipped artifacts) so the leaked default is gone from what
  installs actually run, not just source.
- Known residual (out of scope, needs a `@hasna/contracts` fix): when hosted mode is set
  with a key but no URL, `defaultCloudBaseUrl()` in `@hasna/contracts` still templates
  `https://<app>.hasna.xyz`. `createClientTransport` exposes no base-URL override, so this
  repo cannot close that path alone. Documented explicitly in `tests/cloud-store.test.ts`.

## 0.2.87

Reconcile `main` with the published npm line (`npm/knowledge/v0.2.86`), which had
diverged: the deployed runtime carried a Store-unification + cloud-routing refactor
that never landed on `main`, while `main` carried two CLI fixes the published line
lacked. This release re-converges both histories.

- Merge the published release tag `npm/knowledge/v0.2.86` into `main` (merge commit,
  preserving full ancestry so future `merge-base --is-ancestor` checks pass). Brings in:
  - refactor(store): unify knowledge-item CRUD behind one Store (LocalStore + ApiStore) (1506111)
  - refactor(knowledge): remove dead raw-fetch RemoteKnowledgeClient, make registry descriptor truthful (2b6bd21)
  - fix(knowledge): close residual cloud-mode routing gaps for catalog commands (2d235a9)
  - fix(knowledge): route SDK item CRUD + inventory through the unified Store in all 3 modes (92c3fcc)
  - fix(knowledge): close split-brain read + drop dead API client and client DSN surface (5213a51)
  - fix(knowledge): stop context-pack hang, repair cloud project-panel, drop dead remote command (8daa0ea)
- Retains the two `main`-only CLI fixes on top of the refactor:
  - fix(cli): don't leak internal Error stack on usage/validation errors (#23)
  - fix(cli): make `<sub> --help` print per-command usage (#24)
- Version bumped to 0.2.87 (strictly above published 0.2.86) so npm and `main` reconverge on publish.
