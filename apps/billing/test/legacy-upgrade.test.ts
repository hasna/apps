// Release-review P1 regression (publish-all workflow, 2026-08-21):
// SQLite databases created by 0.1.0 carry UNIQUE(source, source_id, event_type)
// on accounting_reconciliation_events. The 0.1.1 reconciliation upsert uses
// ON CONFLICT(entity_id, source, source_id, event_type), which has no matching
// unique index on a legacy database — the upsert throws "ON CONFLICT clause
// does not match any PRIMARY KEY or UNIQUE constraint" and existing 0.1.0
// SQLite installations cannot emit reconciliation events after upgrading.
//
// This pins the fix: opening a legacy database must rebuild the table with the
// entity-scoped unique constraint, preserving the legacy row and making the
// entity-scoped upsert work.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase } from "../src/db/database.js";
import { upgradeLegacyReconciliationConstraint } from "../src/db/schema.js";
import { emitAccountingReconciliation } from "../src/services/reconciliation.js";
import { TEST_ENTITY_A } from "./helpers.js";

const LEGACY_TABLE_SQL = `CREATE TABLE accounting_reconciliation_events (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  accounting_entry_ref TEXT,
  amount INTEGER,
  currency TEXT,
  state TEXT NOT NULL DEFAULT 'pending',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source, source_id, event_type)
)`;

function writeLegacyDb(path: string): void {
  const raw = new Database(path);
  raw.run(LEGACY_TABLE_SQL);
  raw.run(
    `INSERT INTO accounting_reconciliation_events
       (id, entity_id, source, source_id, event_type, state, payload_json)
     VALUES ('legacy-1', 'legacy-entity', 'stripe', 'evt_legacy_1', 'invoice.payment_succeeded', 'written', '{}')`,
  );
  raw.close();
}

function openLegacyDb(path: string): Database {
  process.env["HASNA_BILLING_DB_PATH"] = path;
  delete process.env["HASNA_BILLING_DATABASE_URL"];
  delete process.env["HASNA_BILLING_DATABASE_URL_FILE"];
  return getDatabase();
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "billing-legacy-upgrade-"));
  closeDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["HASNA_BILLING_DB_PATH"];
});

describe("legacy 0.1.0 SQLite upgrade", () => {
  it("rebuilds the reconciliation table with the entity-scoped unique constraint and preserves the legacy row", () => {
    const path = join(dir, "legacy.db");
    writeLegacyDb(path);

    const db = openLegacyDb(path);

    // The legacy row survives the rebuild.
    const legacyRow = db
      .query("SELECT entity_id, source, source_id, event_type, state FROM accounting_reconciliation_events WHERE id = 'legacy-1'")
      .get() as { entity_id: string; state: string };
    expect(legacyRow).not.toBeNull();
    expect(legacyRow.entity_id).toBe("legacy-entity");
    expect(legacyRow.state).toBe("written");

    // The rebuilt table carries the entity-scoped unique constraint.
    const tableSql = db
      .query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'accounting_reconciliation_events'")
      .get() as { sql: string };
    expect(tableSql.sql).toMatch(/UNIQUE\s*\(\s*entity_id\s*,\s*source\s*,\s*source_id\s*,\s*event_type\s*\)/);
  });

  it("makes the entity-scoped reconciliation upsert work on a legacy database", () => {
    const path = join(dir, "legacy.db");
    writeLegacyDb(path);

    const db = openLegacyDb(path);

    // Same provider event as the legacy row, but a different entity: under
    // entity-scoped uniqueness this is a NEW row, not a collision.
    emitAccountingReconciliation(db, "actor", {
      entity_id: TEST_ENTITY_A,
      source: "stripe",
      source_id: "evt_legacy_1",
      event_type: "invoice.payment_succeeded",
      state: "written",
      accounting_entry_ref: "entry-1",
    });

    // Re-emitting the same logical event for the same entity upserts in place:
    // still exactly one row for TEST_ENTITY_A on this provider event.
    emitAccountingReconciliation(db, "actor", {
      entity_id: TEST_ENTITY_A,
      source: "stripe",
      source_id: "evt_legacy_1",
      event_type: "invoice.payment_succeeded",
      state: "pending",
      accounting_entry_ref: "entry-1",
    });

    const byEntity = db
      .query(
        "SELECT COUNT(*) AS c FROM accounting_reconciliation_events WHERE entity_id = ? AND source_id = 'evt_legacy_1'",
      )
      .get(TEST_ENTITY_A) as { c: number };
    expect(byEntity.c).toBe(1);

    // Two distinct entities on the same provider event stay two rows.
    const byEvent = db
      .query("SELECT COUNT(*) AS c FROM accounting_reconciliation_events WHERE source_id = 'evt_legacy_1'")
      .get() as { c: number };
    expect(byEvent.c).toBe(2);
  });

  it("is a no-op on a fresh database (idempotent on every open)", () => {
    const path = join(dir, "fresh.db");
    process.env["HASNA_BILLING_DB_PATH"] = path;
    delete process.env["HASNA_BILLING_DATABASE_URL"];
    delete process.env["HASNA_BILLING_DATABASE_URL_FILE"];

    const db1 = getDatabase();
    emitAccountingReconciliation(db1, "actor", {
      entity_id: TEST_ENTITY_A,
      source: "stripe",
      source_id: "evt_fresh_1",
      event_type: "invoice.payment_succeeded",
    });
    closeDatabase();

    const db2 = openLegacyDb(path);
    const rows = db2
      .query("SELECT COUNT(*) AS c FROM accounting_reconciliation_events WHERE source_id = 'evt_fresh_1'")
      .get() as { c: number };
    expect(rows.c).toBe(1);
  });
});

// Release-review cycle-2 P1 regression (publish-all workflow, 2026-08-21):
// the table rebuild was not transactional. A failure after creating the
// replacement but before copying rows left the replacement empty and the
// original rows in accounting_reconciliation_events_legacy; the guard then
// saw the replacement's new constraint and skipped recovery — silently
// removing existing reconciliation history from the active table.
// This pins both halves: (1) the rebuild is atomic — any mid-rebuild failure
// rolls back to the untouched legacy state; (2) a legacy table left in place
// by an interrupted rebuild is recovered (rows copied back) on the next open.

const ENTITY_SCOPED_TABLE_SQL = `CREATE TABLE accounting_reconciliation_events (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  accounting_entry_ref TEXT,
  amount INTEGER,
  currency TEXT,
  state TEXT NOT NULL DEFAULT 'pending',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (entity_id, source, source_id, event_type)
)`;

describe("legacy upgrade atomicity (release-review cycle-2 P1)", () => {
  it("recovers rows orphaned by an interrupted rebuild (legacy table present on open)", () => {
    const path = join(dir, "interrupted.db");
    const raw = new Database(path);
    raw.run(LEGACY_TABLE_SQL);
    raw.run(
      `INSERT INTO accounting_reconciliation_events
         (id, entity_id, source, source_id, event_type, state, payload_json)
       VALUES ('interrupted-1', 'legacy-entity', 'stripe', 'evt_int_1', 'invoice.payment_succeeded', 'written', '{}')`,
    );
    // Simulate a crash after rename+create but before the copy: the active
    // table carries the entity-scoped constraint (so the guard would skip),
    // and the rows sit orphaned in the _legacy table.
    raw.run("ALTER TABLE accounting_reconciliation_events RENAME TO accounting_reconciliation_events_legacy");
    raw.run(ENTITY_SCOPED_TABLE_SQL);
    raw.close();

    const db = openLegacyDb(path);
    const legacyTable = db
      .query("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'accounting_reconciliation_events_legacy'")
      .get();
    expect(legacyTable).toBeNull();
    const recovered = db
      .query("SELECT entity_id, source, source_id, event_type, state FROM accounting_reconciliation_events WHERE id = 'interrupted-1'")
      .get() as { entity_id: string; state: string } | null;
    expect(recovered).not.toBeNull();
    expect(recovered?.entity_id).toBe("legacy-entity");
    expect(recovered?.state).toBe("written");
  });

  it("rolls back the rebuild when a mid-rebuild step fails (no orphaned legacy rows, retry succeeds)", () => {
    const path = join(dir, "atomic.db");
    writeLegacyDb(path);

    // Failure injection: the copy step throws. Without a transaction the
    // rename+create would already be committed and the rows orphaned.
    const raw = new Database(path);
    const origRun = raw.run.bind(raw);
    let injected = false;
    raw.run = ((sql: string, ...params: unknown[]) => {
      if (!injected && /INTO\s+accounting_reconciliation_events\b/i.test(sql)) {
        injected = true;
        throw new Error("injected failure mid-rebuild");
      }
      return origRun(sql, ...params);
    }) as typeof raw.run;

    let threw = false;
    try {
      upgradeLegacyReconciliationConstraint(raw);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    // The original legacy state must be intact: no replacement, no legacy
    // table, the row still in the active table with the OLD constraint.
    const activeSql = raw
      .query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'accounting_reconciliation_events'")
      .get() as { sql: string } | null;
    expect(activeSql?.sql).toContain("UNIQUE (source, source_id, event_type)");
    expect(activeSql?.sql).not.toContain("UNIQUE (entity_id, source, source_id, event_type)");
    const legacyTable = raw
      .query("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'accounting_reconciliation_events_legacy'")
      .get();
    expect(legacyTable).toBeNull();
    const row = raw
      .query("SELECT COUNT(*) AS c FROM accounting_reconciliation_events WHERE id = 'legacy-1'")
      .get() as { c: number };
    expect(row.c).toBe(1);

    // A retry with the failure removed completes the upgrade and preserves rows.
    raw.run = origRun;
    upgradeLegacyReconciliationConstraint(raw);
    const upgradedSql = raw
      .query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'accounting_reconciliation_events'")
      .get() as { sql: string } | null;
    expect(upgradedSql?.sql).toContain("UNIQUE (entity_id, source, source_id, event_type)");
    const finalRow = raw
      .query("SELECT COUNT(*) AS c FROM accounting_reconciliation_events WHERE id = 'legacy-1'")
      .get() as { c: number };
    expect(finalRow.c).toBe(1);
    raw.close();
  });
});
