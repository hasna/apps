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
