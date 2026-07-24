import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { getDb, closeDb } from "./db.js";

// Regression: legacy vaults shipped a feedback table with `service TEXT NOT NULL`
// (no default) and an `id` without a generator default. Canonical inserts omit
// both, so they failed with "NOT NULL constraint failed: feedback.service" until
// the migration rebuilds the table. Covers CLI `feedback` and MCP `send_feedback`.
describe("legacy feedback table migration", () => {
  const dirs: string[] = [];
  afterEach(() => {
    closeDb();
    delete process.env.HASNA_SECRETS_DB_PATH;
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function seedLegacy(): string {
    const dir = mkdtempSync(join(tmpdir(), "secrets-legacy-"));
    dirs.push(dir);
    const path = join(dir, "vault.db");
    const db = new Database(path);
    db.exec(`
      CREATE TABLE feedback (
        id TEXT PRIMARY KEY,
        service TEXT NOT NULL,
        version TEXT DEFAULT '',
        message TEXT NOT NULL,
        email TEXT DEFAULT '',
        machine_id TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
    db.run(
      "INSERT INTO feedback (id, service, version, message, email) VALUES (?, ?, ?, ?, ?)",
      ["row-1", "secrets", "0.1.0", "old feedback", "a@b.co"],
    );
    db.close();
    return path;
  }

  it("rebuilds the table, preserves rows, drops service, and unblocks canonical inserts", () => {
    process.env.HASNA_SECRETS_DB_PATH = seedLegacy();
    const db = getDb();

    const cols = (db.prepare("PRAGMA table_info(feedback)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).not.toContain("service");
    expect(cols).toContain("category");

    // pre-existing row survived the rebuild
    const migrated = db.prepare("SELECT id, message, email, version FROM feedback WHERE id = ?").get("row-1") as
      | { id: string; message: string; email: string; version: string }
      | undefined;
    expect(migrated?.message).toBe("old feedback");
    expect(migrated?.email).toBe("a@b.co");

    // the previously-failing canonical insert (id + service omitted) now works
    expect(() =>
      db.run("INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)", [
        "new feedback",
        null,
        "general",
        "0.2.4",
      ]),
    ).not.toThrow();
    expect((db.prepare("SELECT COUNT(*) c FROM feedback").get() as { c: number }).c).toBe(2);
  });

  it("is a no-op on an already-canonical table", () => {
    const dir = mkdtempSync(join(tmpdir(), "secrets-canon-"));
    dirs.push(dir);
    process.env.HASNA_SECRETS_DB_PATH = join(dir, "vault.db");
    getDb(); // first init creates canonical schema
    closeDb();
    // second init must not throw and must keep canonical inserts working
    const db = getDb();
    expect(() =>
      db.run("INSERT INTO feedback (message, category, version) VALUES (?, ?, ?)", ["hi", "general", "0.2.4"]),
    ).not.toThrow();
  });
});
