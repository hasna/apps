import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PG_MIGRATIONS } from "./pg-migrations.js";

const migrationsDirectory = join(import.meta.dir, "../../migrations");

function normalizeSql(sql: string): string {
  return sql.replace(/--.*$/gm, "").replace(/\s+/g, " ").trim();
}

describe("PostgreSQL migration artifacts", () => {
  test("package every runtime migration once, in matching numeric order", async () => {
    const artifactFiles = (await readdir(migrationsDirectory))
      .filter((file) => /^\d{4}_.*\.sql$/.test(file))
      // The contracts-owned API-key DDL is applied separately by ApiKeyStore.
      .filter((file) => file !== "9001_api_keys.sql")
      .sort();
    const expectedNumbers = PG_MIGRATIONS.map((_, index) => String(index + 1).padStart(4, "0"));

    expect(artifactFiles.map((file) => file.slice(0, 4))).toEqual(expectedNumbers);

    for (const [index, migration] of PG_MIGRATIONS.entries()) {
      const artifact = await readFile(join(migrationsDirectory, artifactFiles[index]!), "utf8");
      expect(normalizeSql(artifact)).toBe(normalizeSql(migration));
    }
  });

  test("keeps contact-project membership additive, idempotent, and cascade-safe", () => {
    const migration = PG_MIGRATIONS.find((sql) => sql.includes("CREATE TABLE IF NOT EXISTS contact_projects"));

    expect(migration).toContain("contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE");
    expect(migration).toContain("PRIMARY KEY (contact_id, project_id)");
    expect(migration).toContain("CREATE INDEX IF NOT EXISTS idx_contact_projects_project");
    expect(migration).toContain("CREATE INDEX IF NOT EXISTS idx_contact_projects_contact");
    expect(migration).toContain("ON CONFLICT DO NOTHING");
  });

  test("keeps retained membership authority synchronized with legacy rollback writes", () => {
    const migration = PG_MIGRATIONS.find((sql) =>
      sql.includes("CREATE TABLE IF NOT EXISTS contact_project_membership_states"));

    expect(migration).toContain("AFTER INSERT OR DELETE ON contact_projects");
    expect(migration).toContain("target_linked := TRUE");
    expect(migration).toContain("target_linked := FALSE");
    expect(migration).toContain(
      "contact_project_membership_states.linked IS DISTINCT FROM EXCLUDED.linked",
    );
    expect(migration).toContain("contact_project_membership_states.revision + 1");
    expect(migration).toContain(
      "IF NOT EXISTS (SELECT 1 FROM contacts WHERE id = target_contact_id)",
    );
  });
});
