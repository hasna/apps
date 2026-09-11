import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { planMachineImport, validateMachines } from "./machine-registry.js";
import { runMigrations } from "../db/schema.js";
import { normalizeImportSnapshot } from "../server/v1.js";
import { importSqliteTodosStorageSnapshot, exportSqliteMachines } from "./sqlite-snapshot.js";
import type { Machine } from "../types/index.js";

export const fixtureMachine = (id = "fixture-station04", name = "station04"): Machine => ({ id, name, hostname: "fixture.example.test", platform: "darwin", ssh_address: null, is_primary: false, archived_at: null, metadata: { architecture: "arm64", nested: { untouched: [1, false, "fixture"] } }, last_seen_at: "2026-09-06T21:00:00.000Z", created_at: "2026-01-02T03:04:05.000Z" });
describe("lossless machine registry migration", () => {
  test("preserves both stable IDs, JSON metadata, timestamps and archive/primary flags", () => {
    const rows = [ { ...fixtureMachine(), is_primary: true }, { ...fixtureMachine("fixture-station03", "station03"), archived_at: "2026-09-01T00:00:00.000Z" } ];
    expect(planMachineImport([], rows)).toEqual({ rows, skipped: 0 });
    expect(planMachineImport(rows, structuredClone(rows))).toEqual({ rows: [], skipped: 2 });
    expect(rows[0]!.metadata.nested).toEqual({ untouched: [1, false, "fixture"] });
  });
  test("never merges a name into a different stable identity or a divergent same-ID row", () => {
    const row = fixtureMachine();
    expect(() => planMachineImport([row], [fixtureMachine("different-id")])).toThrow("different identity");
    expect(() => planMachineImport([row], [{ ...row, last_seen_at: "2026-09-07T00:00:00.000Z" }])).toThrow("conflicts");
    expect(() => planMachineImport([], [{ ...row, is_primary: true }, { ...fixtureMachine("two", "two"), is_primary: true }])).toThrow("multiple primary");
  });
  test("SQLite export reads complete rows without rewriting and refuses malformed metadata", () => {
    const db = new Database(":memory:");
    try {
      db.run("CREATE TABLE machines(id TEXT,name TEXT,hostname TEXT,platform TEXT,last_seen_at TEXT,metadata TEXT,created_at TEXT,ssh_address TEXT,is_primary INTEGER,archived_at TEXT)");
      const row = fixtureMachine();
      db.run("INSERT INTO machines VALUES(?,?,?,?,?,?,?,?,?,?)", [row.id,row.name,row.hostname,row.platform,row.last_seen_at,JSON.stringify(row.metadata),row.created_at,row.ssh_address,0,row.archived_at]);
      expect(exportSqliteMachines(db)).toEqual([row]);
      db.run("UPDATE machines SET is_primary=2");
      expect(() => exportSqliteMachines(db)).toThrow("raw SQLite integer");
      db.run("UPDATE machines SET is_primary=0");
      db.run("ALTER TABLE machines ADD COLUMN future_registry_epoch TEXT");
      expect(() => exportSqliteMachines(db)).toThrow("schema differs");
      db.run("ALTER TABLE machines DROP COLUMN future_registry_epoch");

      db.run("UPDATE machines SET metadata='not-json'");
      expect(() => exportSqliteMachines(db)).toThrow();
      expect(db.query("SELECT metadata FROM machines").get()).toEqual({ metadata: "not-json" });
    } finally { db.close(); }
  });
  test("SQLite snapshot importer preserves both records and rejects a conflicting prefix atomically", () => {
    const db = new Database(":memory:");
    try {
      runMigrations(db);
      const rows = [fixtureMachine(), fixtureMachine("station03", "station03")];
      const snapshot = normalizeImportSnapshot({ machines: rows });
      expect(importSqliteTodosStorageSnapshot(snapshot, db)).toMatchObject({ inserted: 2, skipped: 0, errors: [] });
      expect(exportSqliteMachines(db)).toEqual(rows.sort((a,b) => a.id.localeCompare(b.id)));
      expect(importSqliteTodosStorageSnapshot(snapshot, db)).toMatchObject({ inserted: 0, skipped: 2, errors: [] });
      const conflict = normalizeImportSnapshot({ machines: [fixtureMachine("prefix", "prefix"), fixtureMachine("other", "station03")] });
      expect(importSqliteTodosStorageSnapshot(conflict, db).errors).toHaveLength(1);
      expect(exportSqliteMachines(db)).toHaveLength(2);
    } finally { db.close(); }
  });
  test("invalid records and unknown fields fail instead of losing values", () => {
    expect(() => validateMachines([{ ...fixtureMachine(), metadata: null }])).toThrow();
    expect(() => validateMachines([{ ...fixtureMachine(), future_field: "preserve me" }])).toThrow();
    expect(() => validateMachines([{ ...fixtureMachine(), created_at: "invalid" }])).toThrow();
    expect(() => validateMachines([{ ...fixtureMachine(), archived_at: "2026-09-01", is_primary: true }])).toThrow();
  });
});
