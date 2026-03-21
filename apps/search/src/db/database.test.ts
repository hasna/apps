import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "./migrations";

function createTestDb(): Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db);
  return db;
}

describe("database", () => {
  it("should run all migrations", () => {
    const db = createTestDb();
    const migrations = db
      .prepare("SELECT version, description FROM _migrations ORDER BY version")
      .all() as Array<{ version: number; description: string }>;

    expect(migrations.length).toBe(3);
    expect(migrations[0]!.description).toBe("Core tables");
    expect(migrations[1]!.description).toBe("FTS5 on search results");
    expect(migrations[2]!.description).toBe("Seed default providers and profiles");
    db.close();
  });

  it("should seed 12 providers", () => {
    const db = createTestDb();
    const providers = db.prepare("SELECT COUNT(*) as count FROM providers").get() as { count: number };
    expect(providers.count).toBe(12);
    db.close();
  });

  it("should seed 6 profiles", () => {
    const db = createTestDb();
    const profiles = db.prepare("SELECT COUNT(*) as count FROM search_profiles").get() as { count: number };
    expect(profiles.count).toBe(6);
    db.close();
  });

  it("should have FTS5 table", () => {
    const db = createTestDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='search_results_fts'")
      .get();
    expect(tables).toBeTruthy();
    db.close();
  });

  it("should not re-run migrations", () => {
    const db = createTestDb();
    // Run again — should be idempotent
    runMigrations(db);
    const count = (db.prepare("SELECT COUNT(*) as count FROM _migrations").get() as { count: number }).count;
    expect(count).toBe(3);
    db.close();
  });
});
