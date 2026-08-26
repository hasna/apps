# @hasna/billing

## 0.1.5

### Patch Changes

- 877ce39: Switch @hasna/billing local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/billing` default (with the `HASNA_BILLING_HOME` / `BILLING_HOME` exact-app overrides) stays the effective home until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The dependency is pinned exactly to `@hasna/paths@0.2.1` (XDG home migration, hotfixes plan 0f49f56a, task P3.3).
  - @hasna/paths@0.2.1

## 0.1.4

### Patch Changes

- Switch @hasna/billing local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/billing` default (with the `HASNA_BILLING_HOME` / `BILLING_HOME` exact-app overrides) stays the effective home until the store is actually migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. (XDG home migration, hotfixes plan 0f49f56a, task P3.3.)

## 0.1.3

### Patch Changes

- 2598417: billing-serve answers --help and --version before binding, creating the DB pool, or touching credentials; previously it bound the server first (rc=124 timeout) and never printed help or the version (BUG row ad3ae2fe).

## 0.1.2

### Patch Changes

- billing-legacy-reconciliation-constraint: fix(billing): migrate legacy SQLite reconciliation uniqueness constraint. Databases created by 0.1.0 carry `UNIQUE (source, source_id, event_type)` on `accounting_reconciliation_events`; the entity-scoped upsert (`ON CONFLICT(entity_id, source, source_id, event_type)`) had no matching unique index there, so every reconciliation emit threw `ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint` and existing 0.1.0 SQLite installations could not emit reconciliation events after upgrading. Opening a database now rebuilds the legacy table with the entity-scoped constraint (rows preserved; fails closed if legacy data already collided across entities), and a fresh database is untouched (idempotent on every open). The rebuild is transactional (release-review cycle-2 P1): a failure at any step rolls back to the untouched legacy state instead of leaving the replacement empty with the rows orphaned in a \_legacy table, and a \_legacy table left by an interrupted rebuild is recovered on the next open.

## 0.1.1

### Patch Changes

- e935eb9: Coverage-lane hardening from the tests-coverage-sol workflow (2026-08-19): Sol-guided regression tests pinned four defect classes, and the repairs they demand landed with them.

  - Reconciliation: a row already marked `written` to accounting now stays `written` across a webhook redelivery of the same logical event (was: `state = excluded.state` reset it to `pending`, risking double writeback); the upsert conflict target is now entity-scoped `(entity_id, source, source_id, event_type)`, matching the SQLite unique constraint and PostgreSQL migration 0004, so the same provider event under two tenants no longer collapses into one row.
  - Invoices: `mark_invoice_paid` rejects paying an already-paid invoice (`INVALID_TRANSITION`) instead of silently overwriting the recorded `amount_paid`.
  - Customers: `list_customers` honors the declared `status` filter (validated against subscription statuses; the customer's status is its most recent subscription's status) and rejects unknown statuses with `VALIDATION_ERROR` (was: status silently ignored).
  - Migrations: new PostgreSQL migration `0005-core-entity-indexes` adds the six per-table `entity_id` indexes the SQLite schema declares but the plan was missing (entity-scoped reads full-scanned without them).
  - Tests: 11 Sol-guided test files covering reconciliation re-emit semantics, invoice double-pay guards, customer filters/updates, subscription cancel/audit state machines, dunning attempt accounting and fallback schedules, backup/app-home contracts, SQLite/PostgreSQL schema parity, live-adapter verb serialization, CLI openapi generate/check, and support-snapshot limits and entity isolation.
