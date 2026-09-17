import { describe, expect, test } from "bun:test";
import { assertSafePostgresTestUrl } from "./live-postgres-test";

describe("instructions live PostgreSQL test gate", () => {
  test("accepts only an isolated local test database", () => {
    expect(assertSafePostgresTestUrl("postgres://postgres@127.0.0.1:5432/instructions_ci").pathname).toBe("/instructions_ci");
    expect(assertSafePostgresTestUrl("postgresql://postgres@localhost:5432/instructions_test").hostname).toBe("localhost");
  });

  test("refuses production-shaped, remote, and unrelated databases", () => {
    for (const value of [
      "postgres://user@db.example.com:5432/instructions_ci",
      "postgres://user@127.0.0.1:5432/instructions",
      "postgres://user@127.0.0.1:5432/postgres",
      "https://127.0.0.1/instructions_ci",
    ]) {
      expect(() => assertSafePostgresTestUrl(value)).toThrow();
    }
  });
});
