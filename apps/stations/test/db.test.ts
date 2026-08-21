import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, getDb } from "../src/db.js";

const HEARTBEAT_COLUMNS = [
  "daemon_version",
  "agent_mode",
  "platform",
  "os_version",
  "os_build",
  "arch",
  "uptime_seconds",
  "tool_versions_json",
  "tailscale_json",
  "storage_sync_status",
  "storage_sync_last_error",
  "doctor_summary_json",
  "private_metadata",
  "observed_at",
];

describe("database", () => {
  test("creates runtime tables", () => {
    const db = getDb(":memory:");
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((table) => table.name);
    expect(names).toContain("agent_heartbeats");
    expect(names).toContain("mutation_approval_nonces");
    expect(names).toContain("setup_runs");
    expect(names).toContain("sync_runs");

    const columns = db.query("PRAGMA table_info(agent_heartbeats)").all() as Array<{ name: string }>;
    const columnNames = columns.map((column) => column.name);
    for (const column of HEARTBEAT_COLUMNS) expect(columnNames).toContain(column);
  });

  test("migrates existing heartbeat tables with enrichment columns", () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-db-migrate-"));
    const dbPath = join(dir, "stations.db");
    const oldDb = new Database(dbPath);
    oldDb.exec(`
      CREATE TABLE agent_heartbeats (
        machine_id TEXT NOT NULL,
        pid INTEGER NOT NULL,
        status TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (machine_id, pid)
      )
    `);
    oldDb.close();

    const db = getDb(dbPath);
    const columns = db.query("PRAGMA table_info(agent_heartbeats)").all() as Array<{ name: string }>;
    const columnNames = columns.map((column) => column.name);
    for (const column of HEARTBEAT_COLUMNS) expect(columnNames).toContain(column);
    closeDb();
  });
});
