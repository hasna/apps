import { describe, expect, test } from "bun:test";
import { getTestDb } from "./database.js";

function tableNames(db: ReturnType<typeof getTestDb>): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE ? ORDER BY name")
    .all("table", "sqlite_%")
    .map((row: any) => row.name);
}

describe("database", () => {
  test("getTestDb returns a working in-memory database", () => {
    const db = getTestDb();
    expect(db).toBeDefined();

    const row = db.prepare("SELECT 1 as val").get() as { val: number };
    expect(row.val).toBe(1);

    db.close();
  });

  test("migrations create all expected tables", () => {
    const db = getTestDb();
    const names = tableNames(db);

    expect(names).toContain("_migrations");
    expect(names).toContain("projects");
    expect(names).toContain("scans");
    expect(names).toContain("findings");
    expect(names).toContain("rules");
    expect(names).toContain("policies");
    expect(names).toContain("baselines");
    expect(names).toContain("llm_cache");
    expect(names).toContain("agents");

    db.close();
  });

  test("migrations are idempotent across fresh databases", () => {
    const db1 = getTestDb();
    const db2 = getTestDb();

    expect(tableNames(db1)).toEqual(tableNames(db2));

    db1.close();
    db2.close();
  });

  test("foreign keys are enabled", () => {
    const db = getTestDb();
    const row = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
    expect(row.foreign_keys).toBe(1);
    db.close();
  });

  test("migrations table tracks applied migrations", () => {
    const db = getTestDb();
    const migrations = db
      .prepare("SELECT name FROM _migrations")
      .all() as Array<{ name: string }>;

    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations[0].name).toBe("001_initial");

    db.close();
  });
});
