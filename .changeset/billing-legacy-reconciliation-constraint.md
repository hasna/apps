---
"@hasna/billing": patch
---

fix(billing): migrate legacy SQLite reconciliation uniqueness constraint. Databases created by 0.1.0 carry `UNIQUE (source, source_id, event_type)` on `accounting_reconciliation_events`; the entity-scoped upsert (`ON CONFLICT(entity_id, source, source_id, event_type)`) had no matching unique index there, so every reconciliation emit threw `ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint` and existing 0.1.0 SQLite installations could not emit reconciliation events after upgrading. Opening a database now rebuilds the legacy table with the entity-scoped constraint (rows preserved; fails closed if legacy data already collided across entities), and a fresh database is untouched (idempotent on every open). Found by the publish-all release review; regression tests in `test/legacy-upgrade.test.ts` pin the legacy-upgrade path, the entity-scoped upsert, and the fresh-schema no-op.
