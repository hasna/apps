/**
 * Storage-backend collapse conformance (owner directive 2026-07-29, knowledge
 * k_ms3e6v41_zbe7m8): the three deployment "modes" (local / self_hosted|remote /
 * hybrid / cloud) collapse into a single two-value data-backend switch —
 * `sqlite | postgres` — for the server-side/native storage tooling. Legacy env
 * tokens keep working (the fleet sets `remote`), but they normalize onto the two
 * arms at the parse boundary: there is no third arm, and no deployment-mode word
 * survives in the parsed model or in refusal text.
 */
import { describe, expect, test } from "bun:test";
import {
  TODOS_STORAGE_ENV,
  createTodosStorageAdapter,
  isTodosRemoteStorageEnabled,
  loadTodosStorageConfig,
  parseStorageMode,
} from "./index.js";
import type { TodosPostgresQueryClient } from "./postgres-sync.js";

const DSN = "postgres://user@db.example.test:5432/todos";

/** Minimal no-op Postgres client: the factory must not open a real connection. */
function fakePostgresClient(): TodosPostgresQueryClient {
  return {
    query: async () => ({ rows: [] }),
    close: async () => {},
  } as unknown as TodosPostgresQueryClient;
}

describe("storage backend collapse (sqlite|postgres)", () => {
  test("default backend is sqlite", () => {
    expect(parseStorageMode(undefined)).toBe("sqlite");
    expect(loadTodosStorageConfig({}).mode).toBe("sqlite");
  });

  test("canonical backend tokens are accepted", () => {
    expect(parseStorageMode("sqlite")).toBe("sqlite");
    expect(parseStorageMode("postgres")).toBe("postgres");
    expect(parseStorageMode("postgresql")).toBe("postgres");
  });

  test("legacy placement tokens normalize onto the two backends", () => {
    expect(parseStorageMode("local")).toBe("sqlite");
    expect(parseStorageMode("remote")).toBe("postgres");
  });

  test("deprecated deployment-mode tokens collapse to postgres — never a third arm", () => {
    for (const legacy of ["hybrid", "self_hosted", "cloud"]) {
      expect(parseStorageMode(legacy)).toBe("postgres");
    }
  });

  test("an invalid backend refusal names only the two backends, no deployment modes", () => {
    let message = "";
    try {
      parseStorageMode("bogus-mode");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("sqlite");
    expect(message).toContain("postgres");
    expect(message).not.toMatch(/hybrid|self_hosted|self-hosted/);
  });

  test("the parsed config model carries the backend, not a placement", () => {
    const config = loadTodosStorageConfig({
      [TODOS_STORAGE_ENV.mode]: "remote",
      [TODOS_STORAGE_ENV.databaseUrl]: DSN,
    });
    expect(config.mode).toBe("postgres");
    expect(isTodosRemoteStorageEnabled(config)).toBe(true);
    const local = loadTodosStorageConfig({});
    expect(local.mode).toBe("sqlite");
    expect(isTodosRemoteStorageEnabled(local)).toBe(false);
  });

  test("the factory has exactly two arms: hybrid env selection yields the postgres adapter", () => {
    const adapter = createTodosStorageAdapter({
      env: {
        [TODOS_STORAGE_ENV.mode]: "hybrid",
        [TODOS_STORAGE_ENV.databaseUrl]: DSN,
      },
      postgresClient: fakePostgresClient(),
    });
    expect(adapter.kind).toBe("postgres");
    expect(adapter.capabilities.remotePersistence).toBe(true);
    // The hybrid dual-write adapter is reachable only through its explicit
    // constructor (createHybridTodosStorageAdapter) — never through the
    // backend switch.
    expect(adapter.capabilities.localPersistence).toBe(false);
  });

  test("the default arm is the local sqlite adapter", async () => {
    const { getDatabase, resetDatabase } = await import("../db/database.js");
    resetDatabase();
    try {
      const adapter = createTodosStorageAdapter({
        env: {},
        local: { db: getDatabase(":memory:") },
      });
      expect(adapter.kind).toBe("sqlite");
      expect(adapter.capabilities.localPersistence).toBe(true);
    } finally {
      resetDatabase();
    }
  });
});

describe("new backend API surface", () => {
  test("parseStorageBackend / isTodosPostgresBackend are exported and collapsed", async () => {
    const mod = await import("./index.js") as Record<string, unknown>;
    const parseStorageBackend = mod["parseStorageBackend"] as ((v?: string) => string) | undefined;
    const isTodosPostgresBackend = mod["isTodosPostgresBackend"] as ((c: unknown) => boolean) | undefined;
    expect(typeof parseStorageBackend).toBe("function");
    expect(typeof isTodosPostgresBackend).toBe("function");
    expect(parseStorageBackend!("remote")).toBe("postgres");
    expect(parseStorageBackend!(undefined)).toBe("sqlite");
    const config = loadTodosStorageConfig({
      [TODOS_STORAGE_ENV.mode]: "postgres",
      [TODOS_STORAGE_ENV.databaseUrl]: DSN,
    });
    expect(isTodosPostgresBackend!(config)).toBe(true);
  });
});
