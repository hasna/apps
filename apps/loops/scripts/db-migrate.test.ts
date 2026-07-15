import { describe, expect, test } from "bun:test";
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
});
