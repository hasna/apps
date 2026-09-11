/**
 * Hermetic upgrade test for migration 7 (`domain_history_snapshot_types`).
 *
 * The on-box SQLite schema lagged the cloud Postgres schema: the CHECK on
 * `domain_history.snapshot_type` allowed only the six lookup types, while
 * `sedo buy` and `wallet buy|renew` write `purchase` / `renewal` through the
 * shared store — the same command must work on every transport. SQLite cannot
 * alter a CHECK constraint in place, so migration 7 rebuilds the table.
 *
 * This test builds a DATABASE WITH THE OLD SHAPE (embedded OLD DDL, since the
 * current migration 4 already carries the new CHECK), seeds rows, applies the
 * migration SQL, and asserts the rows survive and the new types are accepted.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { MIGRATIONS } from "./migrations.js";

const OLD_DOMAIN_HISTORY_DDL = `
  CREATE TABLE domain_history (
    id TEXT PRIMARY KEY,
    domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    snapshot_type TEXT NOT NULL CHECK (snapshot_type IN ('whois', 'rdap', 'dns', 'ssl', 'reputation', 'exa_research')),
    raw_data TEXT NOT NULL DEFAULT '{}',
    registrant_name TEXT,
    registrant_email TEXT,
    registrant_org TEXT,
    nameservers TEXT NOT NULL DEFAULT '[]',
    registrar TEXT,
    status TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

describe("sqlite migration 7: domain_history snapshot types (hermetic)", () => {
  test("an old-shape DB keeps its rows and accepts purchase/renewal after the rebuild", () => {
    const dir = mkdtempSync(join(tmpdir(), "domains-migration7-"));
    const path = join(dir, "old.db");
    try {
      const db = new Database(path);
      db.exec("PRAGMA foreign_keys = ON");
      db.exec(`
        CREATE TABLE domains (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL
        );
      `);
      db.exec(OLD_DOMAIN_HISTORY_DDL);
      db.exec(`
        INSERT INTO domains (id, name) VALUES ('d1', 'example.com');
        INSERT INTO domain_history (id, domain_id, snapshot_type, raw_data)
          VALUES ('h1', 'd1', 'whois', '{"k":"v"}');
      `);

      // Apply migration 7 exactly as the runner would (transactional batch).
      const migration7 = MIGRATIONS.find((m) => m.id === 7);
      expect(migration7).toBeDefined();
      db.exec(`
        CREATE TABLE IF NOT EXISTS _migrations (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      db.exec("BEGIN");
      db.exec(migration7!.sql);
      db.exec(`INSERT INTO _migrations (id, name) VALUES (7, 'domain_history_snapshot_types')`);
      db.exec("COMMIT");

      // Rows survived the rebuild.
      const rows = db.query("SELECT * FROM domain_history").all() as Array<{ id: string; snapshot_type: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe("h1");
      expect(rows[0]!.snapshot_type).toBe("whois");

      // The types that previously crashed now write (sedo buy / wallet buy|renew).
      db.prepare(
        "INSERT INTO domain_history (id, domain_id, snapshot_type, raw_data) VALUES ('h2', 'd1', 'purchase', '{}')",
      ).run();
      db.prepare(
        "INSERT INTO domain_history (id, domain_id, snapshot_type, raw_data) VALUES ('h3', 'd1', 'renewal', '{}')",
      ).run();

      // The old six lookup types are still accepted, and an unknown type still refuses.
      db.prepare(
        "INSERT INTO domain_history (id, domain_id, snapshot_type, raw_data) VALUES ('h4', 'd1', 'rdap', '{}')",
      ).run();
      expect(() =>
        db.prepare(
          "INSERT INTO domain_history (id, domain_id, snapshot_type, raw_data) VALUES ('h5', 'd1', 'bogus', '{}')",
        ).run(),
      ).toThrow(/CHECK constraint failed/);

      // Indexes the rebuild recreates are present and usable.
      const indexes = db.query("PRAGMA index_list(domain_history)").all() as Array<{ name: string }>;
      const names = indexes.map((i) => i.name);
      expect(names).toContain("idx_domain_history_domain");
      expect(names).toContain("idx_domain_history_type");
      expect(names).toContain("idx_domain_history_created");
      expect(names).toContain("idx_domain_history_email");

      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the migration list carries exactly one rebuild, after the freshness migration", () => {
    const ids = MIGRATIONS.map((m) => m.id);
    expect(ids).toContain(7);
    expect(ids.indexOf(7)).toBe(ids.indexOf(6) + 1);
    // The CURRENT create-table DDL (migration 4) already carries the 8 types,
    // so fresh databases start correct without needing to settle into a rebuild.
    const migration4 = MIGRATIONS.find((m) => m.id === 4);
    expect(migration4!.sql).toMatch(/exa_research', 'purchase', 'renewal'/);
  });
});