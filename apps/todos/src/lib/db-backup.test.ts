import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTask } from "../db/tasks.js";
import {
  DB_BACKUP_SCHEMA,
  backupDatabase,
  restoreDatabase,
  checkDatabaseIntegrity,
  compactDatabase,
  migrationDryRun,
} from "./db-backup.js";

let tempDir: string;
let dbPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "todos-backup-"));
  dbPath = join(tempDir, "todos.db");
  process.env["TODOS_DB_PATH"] = dbPath;
  resetDatabase();
  getDatabase();
  createTask({ title: "Backup test task" });
  closeDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  rmSync(tempDir, { recursive: true, force: true });
});

describe("db backup", () => {
  it("backs up and restores database atomically", () => {
    const backupPath = join(tempDir, "backup.db");
    const result = backupDatabase(backupPath, dbPath);
    expect(result.schema_version).toBe(DB_BACKUP_SCHEMA);
    expect(existsSync(backupPath)).toBe(true);

    const restoreTarget = join(tempDir, "restored.db");
    restoreDatabase(backupPath, restoreTarget);

    process.env["TODOS_DB_PATH"] = restoreTarget;
    resetDatabase();
    const db = getDatabase();
    const count = db.query("SELECT COUNT(*) as c FROM tasks").get() as { c: number };
    expect(count.c).toBe(1);
    closeDatabase();
  });

  it("checks integrity on valid database", () => {
    const result = checkDatabaseIntegrity(dbPath);
    expect(result.ok).toBe(true);
    expect(result.quick_check).toBe("ok");
    expect(result.tables).toBeGreaterThan(0);
  });

  it("detects corrupted database file", () => {
    const badPath = join(tempDir, "bad.db");
    require("node:fs").writeFileSync(badPath, "not a sqlite database");
    const result = checkDatabaseIntegrity(badPath);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("runs migration dry-run", () => {
    const result = migrationDryRun(dbPath);
    expect(result.schema_version).toBe(DB_BACKUP_SCHEMA);
    expect(result.current_version).toBeGreaterThanOrEqual(0);
  });

  it("compacts database", () => {
    const result = compactDatabase(dbPath);
    expect(result.bytes_after).toBeGreaterThan(0);
  });
});
