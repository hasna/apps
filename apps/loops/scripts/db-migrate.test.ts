import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { logMigrationFailure } from "./db-migrate.js";

describe("db migration script logging", () => {
  test("logs command failures without provider details", () => {
    const logged: string[] = [];
    const originalError = console.error;
    console.error = (...values: unknown[]) => { logged.push(values.map(String).join(" ")); };
    try {
      logMigrationFailure(Object.assign(new Error("postgres://user:secret@db.internal/loops"), {
        name: "postgres://name-secret@db.internal/loops",
        code: "postgres://code-secret@db.internal/loops",
      }));
      expect(logged).toEqual([JSON.stringify({ evt: "loops_migrate_failed", errorType: "error" })]);
    } finally {
      console.error = originalError;
    }
  });

  test("every standalone migration runner delegates cutover phases to the shared guarded executor", () => {
    for (const script of ["db-migrate.ts", "db-migrate-tunnel.ts"]) {
      const source = readFileSync(new URL(script, import.meta.url), "utf8");
      expect(source).toContain("runGuardedPostgresMigrations");
      expect(source).not.toContain("schema.migrate({");
      expect(source).not.toContain("enforceTenancy ? undefined");
    }
  });
});
