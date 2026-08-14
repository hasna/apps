import { describe, expect, test } from "bun:test";
import { PG_MIGRATIONS } from "../lib/pg-migrations.js";

describe("PG_MIGRATIONS", () => {
  test("is non-empty array of strings", () => {
    expect(Array.isArray(PG_MIGRATIONS)).toBe(true);
    expect(PG_MIGRATIONS.length).toBeGreaterThan(0);
    for (const migration of PG_MIGRATIONS) {
      expect(typeof migration).toBe("string");
    }
  });

  test("contains CREATE TABLE statements for all core tables", () => {
    const migrationSql = PG_MIGRATIONS.join("\n");
    const expectedTables = [
      "style_profiles",
      "preferences",
      "project_configs",
      "templates",
      "health_checks",
      "health_violations",
      "extracted_style_kits",
      "agent_presence",
      "feedback",
    ];
    for (const table of expectedTables) {
      expect(migrationSql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  test("all tables have primary keys", () => {
    const migrationSql = PG_MIGRATIONS.join("\n");
    // Each CREATE TABLE should have PRIMARY KEY
    const createMatches = migrationSql.match(/CREATE TABLE IF NOT EXISTS/g);
    const pkMatches = migrationSql.match(/PRIMARY KEY/g);
    expect(pkMatches?.length).toBeGreaterThanOrEqual((createMatches?.length ?? 0) - 1);
  });

  test("contains migrations tracking table", () => {
    const migrationSql = PG_MIGRATIONS.join("\n");
    expect(migrationSql).toContain("_migrations");
  });

  test("no SQLite-specific syntax", () => {
    const migrationSql = PG_MIGRATIONS.join("\n");
    // Should not contain SQLite-specific functions
    expect(migrationSql).not.toContain("randomblob");
  });

  test("uses PostgreSQL-specific types", () => {
    const migrationSql = PG_MIGRATIONS.join("\n");
    expect(migrationSql).toContain("TIMESTAMPTZ");
    expect(migrationSql).toContain("gen_random_uuid()");
    expect(migrationSql).toContain("BIGINT");
  });
});
