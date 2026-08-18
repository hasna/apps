/**
 * Storage-backend selection conformance (owner directive 2026-07-29, knowledge
 * k_ms3e6v41_zbe7m8): the server-side data backend is a single two-value
 * switch — `sqlite | postgres` — derived from the environment, never selected
 * by a mode variable. Retired storage-mode variables are inert: the backend is
 * derived from HASNA_TODOS_DATABASE_URL (set selects postgresql, unset selects
 * sqlite). No deployment-mode word survives in the parsed model or in refusal
 * text.
 */
import { describe, expect, test } from "bun:test";
import {
  TODOS_STORAGE_ENV,
  createTodosStorageAdapter,
  loadTodosStorageConfig,
  parseStorageBackend,
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
    expect(parseStorageBackend(undefined)).toBe("sqlite");
    expect(loadTodosStorageConfig({}).mode).toBe("sqlite");
  });

  test("canonical backend tokens are accepted", () => {
    expect(parseStorageBackend("sqlite")).toBe("sqlite");
    expect(parseStorageBackend("postgres")).toBe("postgres");
    expect(parseStorageBackend("postgresql")).toBe("postgres");
  });

  test("legacy placement tokens are invalid backend input, never normalized", () => {
    for (const legacy of ["local", "remote", "hybrid", "self_hosted", "cloud"]) {
      expect(() => parseStorageBackend(legacy)).toThrow(/Storage backend must be sqlite or postgres/);
    }
  });

  test("an invalid backend refusal names only the two backends, no deployment modes", () => {
    let message = "";
    try {
      parseStorageBackend("bogus-mode");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("sqlite");
    expect(message).toContain("postgres");
    expect(message).not.toMatch(/hybrid|self_hosted|self-hosted/);
  });

  test("the parsed config model carries the backend derived from the DSN, not a placement", () => {
    const config = loadTodosStorageConfig({
      [TODOS_STORAGE_ENV.databaseUrl]: DSN,
    });
    expect(config.mode).toBe("postgres");
    const local = loadTodosStorageConfig({});
    expect(local.mode).toBe("sqlite");
  });

  test("the factory has exactly two arms: a DSN selects the postgres adapter", () => {
    const adapter = createTodosStorageAdapter({
      env: {
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

  test("a retired storage-mode variable is inert even with a complete DSN", () => {
    const config = loadTodosStorageConfig({
      [TODOS_STORAGE_ENV.databaseUrl]: DSN,
      HASNA_TODOS_STORAGE_MODE: "postgres",
    });
    expect(config.mode).toBe("postgres");
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
    expect(parseStorageBackend!("postgres")).toBe("postgres");
    expect(parseStorageBackend!(undefined)).toBe("sqlite");
    const config = loadTodosStorageConfig({
      [TODOS_STORAGE_ENV.databaseUrl]: DSN,
    });
    expect(isTodosPostgresBackend!(config)).toBe(true);
  });
});
