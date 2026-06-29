import { describe, expect, test } from "bun:test";
import { PG_MIGRATIONS } from "./pg-migrations.js";

describe("PostgreSQL remote database migrations", () => {
  test("include late SQLite schema used by tester-platform features", () => {
    const sql = PG_MIGRATIONS.join("\n");

    expect(sql).toContain("ALTER TABLE results ADD COLUMN IF NOT EXISTS har_path TEXT");
    expect(sql).toContain("ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS parameters TEXT");
    expect(sql).toContain("ALTER TABLE personas ADD COLUMN IF NOT EXISTS auth_strategy TEXT");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS step_results");
    expect(sql).toContain("ALTER TABLE runs ADD COLUMN IF NOT EXISTS pr_number INTEGER");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS sessions");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS testing_workflows");
  });
});
