import { describe, expect, test } from "bun:test";
import { defineMigration, type AppliedMigration } from "../generated/storage-kit/index.js";
import {
  assertMigrationCompatibility,
  loadMigrations,
  resolveMigrationsDir,
} from "./migrations.js";

describe("projects-serve migrations", () => {
  test("resolves the on-disk migrations directory", () => {
    const dir = resolveMigrationsDir();
    expect(dir).toContain("migrations");
  });

  test("loads baseline schema + api-keys migrations with unique ids", () => {
    const migrations = loadMigrations();
    expect(migrations.length).toBeGreaterThanOrEqual(2);
    const ids = migrations.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((id) => id.startsWith("projects:0001_baseline"))).toBe(true);
    // The api-keys table migration comes from @hasna/contracts/auth.
    expect(migrations.some((m) => /api_key/i.test(m.sql))).toBe(true);
    // Baseline creates the core workspaces table.
    expect(migrations.some((m) => /CREATE TABLE IF NOT EXISTS workspaces/i.test(m.sql))).toBe(true);
  });

  test("every migration has a sha256 checksum", () => {
    for (const m of loadMigrations()) {
      expect(m.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });

  test("unknown applied migrations fail closed with the non-secret checksum", () => {
    const applied: AppliedMigration[] = [{
      id: "projects:0002_tenants",
      checksum: "sha256:legacy-checksum",
      appliedAt: "2026-07-13T00:00:00.000Z",
    }];

    expect(() => assertMigrationCompatibility([defineMigration("projects:0001_baseline", "SELECT 1")], applied))
      .toThrow(
        "Applied migration 'projects:0002_tenants' (checksum 'sha256:legacy-checksum') is not recognized by this build (downgrade?).",
      );
  });

  test("checksum drift reports applied and expected checksums without accepting it", () => {
    const migration = defineMigration("projects:0001_baseline", "SELECT 1");
    const applied: AppliedMigration[] = [{
      id: migration.id,
      checksum: "sha256:changed",
      appliedAt: "2026-07-13T00:00:00.000Z",
    }];

    expect(() => assertMigrationCompatibility([migration], applied))
      .toThrow(
        `Migration checksum mismatch for '${migration.id}': applied 'sha256:changed', expected '${migration.checksum}'.`,
      );
  });
});
