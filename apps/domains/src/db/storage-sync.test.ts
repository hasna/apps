process.env.DOMAINS_DB_PATH = ":memory:";

import { afterEach, describe, expect, it } from "bun:test";
import { closeDatabase } from "./database.js";
import {
  STORAGE_DATABASE_ENV,
  STORAGE_MODE_ENV,
  STORAGE_TABLES,
  getStorageDatabaseEnvName,
  getStorageDatabaseUrl,
  getStorageMode,
  getStorageStatus,
  resolveTables,
} from "./storage-sync.js";

const ENV_NAMES = [
  ...STORAGE_DATABASE_ENV,
  ...STORAGE_MODE_ENV,
] as const;

afterEach(() => {
  for (const name of ENV_NAMES) {
    delete process.env[name];
  }
  closeDatabase();
});

describe("domains storage configuration", () => {
  it("prefers canonical storage database env over fallback", () => {
    process.env["DOMAINS_DATABASE_URL"] = "postgres://new.example/domains";
    process.env["HASNA_DOMAINS_DATABASE_URL"] = "postgres://fallback.example/domains";

    expect(getStorageDatabaseUrl()).toBe("postgres://new.example/domains");
    expect(getStorageDatabaseEnvName()).toBe("DOMAINS_DATABASE_URL");
  });

  it("uses fallback storage database env when canonical env is absent", () => {
    process.env["HASNA_DOMAINS_DATABASE_URL"] = "postgres://fallback.example/domains";

    expect(getStorageDatabaseUrl()).toBe("postgres://fallback.example/domains");
    expect(getStorageDatabaseEnvName()).toBe("HASNA_DOMAINS_DATABASE_URL");
  });

  it("uses explicit storage mode when configured", () => {
    process.env["DOMAINS_STORAGE_MODE"] = "hybrid";

    expect(getStorageMode()).toBe("hybrid");
  });

  it("reports storage status for CLI and MCP surfaces", () => {
    process.env["DOMAINS_DATABASE_URL"] = "postgres://new.example/domains";

    expect(getStorageStatus()).toMatchObject({
      configured: true,
      mode: "remote",
      service: "domains",
    });
  });

  it("returns all tables by default and rejects unknown tables", () => {
    expect(resolveTables()).toEqual([...STORAGE_TABLES]);
    expect(() => resolveTables(["domains", "missing"])).toThrow("Unknown domains sync table");
  });
});
