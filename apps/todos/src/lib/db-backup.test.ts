import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
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


describe("standalone WAL backup safety", () => {
  it("includes committed uncheckpointed WAL rows and reopens read-only without sidecars", () => {
    const sourcePath = join(tempDir, "active-wal.db");
    const source = new Database(sourcePath);
    try {
      source.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE fixture(id INTEGER PRIMARY KEY, value TEXT);");
      source.query("INSERT INTO fixture VALUES(?,?)").run(1,"committed fixture");
      expect(statSync(`${sourcePath}-wal`).size).toBeGreaterThan(0);
      const output = join(tempDir,"private snapshot #1.db");
      const result = backupDatabase(output,sourcePath);
      expect(result.method).toBe("sqlite_vacuum");
      expect(statSync(output).mode & 0o777).toBe(0o600);
      const check = new Database(output,{readonly:true});
      try {
        expect(check.query("SELECT * FROM fixture").all()).toEqual([{id:1,value:"committed fixture"}]);
        expect(check.query("PRAGMA quick_check").get()).toEqual({quick_check:"ok"});
      } finally { check.close(); }
      expect(existsSync(`${output}-wal`)).toBe(false);
      expect(existsSync(`${output}-shm`)).toBe(false);
      expect(source.query("SELECT count(*) AS n FROM fixture").get()).toEqual({n:1});
    } finally {source.close();}
  });

  it("rejects invalid foreign keys without replacing an existing backup or leaving staging files", () => {
    const invalidPath = join(tempDir,"invalid-reference.db");
    const source = new Database(invalidPath);
    source.exec("PRAGMA foreign_keys=OFF; CREATE TABLE parents(id INTEGER PRIMARY KEY); CREATE TABLE children(parent_id INTEGER REFERENCES parents(id)); INSERT INTO children VALUES(99);");
    source.close();
    const output = join(tempDir,"existing-backup.db");
    writeFileSync(output,"prior backup bytes",{mode:0o600});
    const before = readdirSync(tempDir).sort();
    expect(()=>backupDatabase(output,invalidPath)).toThrow("foreign_key_check");
    expect(readFileSync(output,"utf8")).toBe("prior backup bytes");
    expect(readdirSync(tempDir).sort()).toEqual(before);
    expect(checkDatabaseIntegrity(invalidPath).foreign_keys).toBe(false);
  });
});
