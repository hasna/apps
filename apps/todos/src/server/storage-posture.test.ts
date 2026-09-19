import { describe, expect, test } from "bun:test";
import {
  SERVER_STORAGE_CONFIG_MISSING,
  ServerStorageNotConfiguredError,
  resolveServerStorageMode,
} from "./storage-posture.js";

describe("todos-serve storage posture", () => {
  test("production intent without a database URL fails closed instead of selecting SQLite", () => {
    expect(() => resolveServerStorageMode({ NODE_ENV: "production" })).toThrow(ServerStorageNotConfiguredError);
    try {
      resolveServerStorageMode({ NODE_ENV: "production", PORT: "8080", HOST: "0.0.0.0" });
      throw new Error("expected production storage refusal");
    } catch (error) {
      expect((error as ServerStorageNotConfiguredError).code).toBe(SERVER_STORAGE_CONFIG_MISSING);
      expect((error as Error).message).toContain("HASNA_TODOS_DATABASE_URL");
      expect((error as Error).message).toContain("HASNA_TODOS_LOCAL=1");
    }
  });

  test("explicit local-only mode remains available for self-hosting and development", () => {
    expect(resolveServerStorageMode({ HASNA_TODOS_LOCAL: "1" })).toBe("sqlite");
    expect(resolveServerStorageMode({ TODOS_LOCAL: "1", NODE_ENV: "production" })).toBe("sqlite");
  });

  test("a hosted database URL wins over a stale local opt-in", () => {
    expect(resolveServerStorageMode({
      NODE_ENV: "production",
      HASNA_TODOS_LOCAL: "1",
      HASNA_TODOS_DATABASE_URL: "postgres://todos@example.invalid/todos",
    })).toBe("postgresql");
  });

  test("an explicit SQLite path alone is not a local-mode opt-in", () => {
    expect(() => resolveServerStorageMode({ TODOS_DB_PATH: "/tmp/todos.db" })).toThrow(
      ServerStorageNotConfiguredError,
    );
  });
});
