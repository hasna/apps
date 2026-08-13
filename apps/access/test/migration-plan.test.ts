import { Database } from "bun:sqlite";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { closeDatabase, openDatabase, resetDatabase } from "../src/db/database.js";

let tempDir: string | null = null;

afterEach(() => {
  closeDatabase();
  resetDatabase();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
  delete process.env["HASNA_ACCESS_DB_PATH"];
  delete process.env["HASNA_ACCESS_HOME"];
});

function createOldV1Database(path: string): void {
  const db = new Database(path);
  try {
    db.run("CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))");
    db.run("INSERT INTO schema_migrations (id) VALUES (1)");
    db.run(`
      CREATE TABLE identities (
        id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        entity_slug TEXT,
        kind TEXT NOT NULL CHECK (kind IN ('agent','service','human')),
        name TEXT NOT NULL,
        owner_ref TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','retired')),
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        version INTEGER NOT NULL DEFAULT 1
      )
    `);
    db.run(`
      CREATE TABLE elevations (
        id TEXT PRIMARY KEY,
        identity_id TEXT NOT NULL REFERENCES identities(id),
        entity_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        reason TEXT NOT NULL,
        approver TEXT,
        requested_by TEXT,
        expires_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','revoked')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        version INTEGER NOT NULL DEFAULT 1
      )
    `);
    db.run("CREATE INDEX idx_elevations_identity ON elevations(identity_id)");
    db.query(
      `INSERT INTO identities (id, entity_id, kind, name, created_at, updated_at)
       VALUES ('agent-old', '00000000-0000-4000-8000-000000000001', 'agent', 'old', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z')`,
    ).run();
    db.query(
      `INSERT INTO elevations (id, identity_id, entity_id, scope, reason, approver, requested_by, expires_at, status, created_at, updated_at, version)
       VALUES
       ('e-unapproved', 'agent-old', '00000000-0000-4000-8000-000000000001', 'secrets:write', 'old bug', NULL, 'agent-old', '2099-01-01T00:00:00.000Z', 'active', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', 1),
       ('e-approved', 'agent-old', '00000000-0000-4000-8000-000000000001', 'wallets:read', 'approved', 'andrei', 'agent-old', '2099-01-01T00:00:00.000Z', 'active', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', 1)`,
    ).run();
  } finally {
    db.close();
  }
}

describe("forward migrations", () => {
  it("migrates existing v1 stores to access_requests and pending elevation semantics with a backup", () => {
    tempDir = mkdtempSync(join(tmpdir(), "access-migration-"));
    const dbPath = join(tempDir, "access.db");
    process.env["HASNA_ACCESS_DB_PATH"] = dbPath;
    process.env["HASNA_ACCESS_HOME"] = join(tempDir, "home");
    createOldV1Database(dbPath);

    const db = openDatabase();
    const ids = db.query("SELECT id FROM schema_migrations ORDER BY id").all() as Array<{ id: number }>;
    expect(ids.map((row) => row.id)).toEqual([1, 2]);

    const accessRequestColumns = db.query("PRAGMA table_info(access_requests)").all() as Array<{ name: string }>;
    expect(accessRequestColumns.map((column) => column.name)).toContain("secret_ref");

    const elevations = db.query("SELECT id, status FROM elevations ORDER BY id").all() as Array<{ id: string; status: string }>;
    expect(elevations).toEqual([
      { id: "e-approved", status: "active" },
      { id: "e-unapproved", status: "pending" },
    ]);
    expect(db.query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'elevations'").get()).toEqual(
      expect.objectContaining({ sql: expect.stringContaining("'pending'") }),
    );
    closeDatabase();

    const backups = readdirSync(join(tempDir, "home", "backups"));
    expect(backups.some((name) => name.endsWith("-pre-migration.db"))).toBe(true);
  });
});
