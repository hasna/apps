# Changelog

## 0.2.21 — 2026-08-10

- Add `secrets scan input [path|-]`, a bounded input/stdin scan mode so tool
  output can be scanned for credential exposures before it is persisted. Reuses
  the existing redacting detector engine and the staged gate's three-way exit
  contract: 0 read it all and found nothing, 1 found something, 2 could not read
  it all. `stdin` and `text` resolve to it as aliases. Over-bound input records a
  skip and returns 2 rather than a false clean.

## 0.2.20 — 2026-08-09

- Resolve account-scoped `--env` selectors through paged AWS metadata using
  canonical provider paths, with exact-name compatibility and fail-closed
  handling for missing, ambiguous, non-current, or non-string secrets.

## 0.2.19 — 2026-08-09

- Add account-scoped `secrets exec --provider ... --account ... --env ...`
  consumption through standard AWS profiles while preserving legacy key/`--as`
  execution.

## 0.2.18 — 2026-08-08

- Require a left boundary before OpenAI secret-key matches so task-first slugs
  like `OPE45-00025-openai-key-boundary` are not reported as credential leaks.

## 0.2.17 — 2026-08-08

- Reject unsupported `secrets scan` flags instead of silently scanning the
  current workspace.
- Return a nonzero exit when workspace or history scans report errors, while
  preserving redacted JSON evidence and successful directory scans.

## 0.2.16 — 2026-08-08

- Reconcile production tenant-migration lineage through schema verification
  and an idempotent backfill while keeping unknown checksum drift fatal.
- Bind cloud writes to persisted tenant assignments and reject unassigned
  credentials before mutation, including concurrent and post-backfill writes.

## 0.2.15 — 2026-08-08

- Preserve schema-proven compatibility for the legacy checksum of
  `secrets_0010_tenant_columns` when all expected tenant columns and Postgres
  types are present; unknown checksum drift remains fatal.

## 0.2.14 — 2026-08-08

- Restored the production migration lineage for `secrets_0008_tenants`, so
  deployments recognize the already-applied tenants migration.
