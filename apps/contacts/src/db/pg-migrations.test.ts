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
});
