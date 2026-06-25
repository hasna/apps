import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import "./setup";
import {
  getStorageDatabaseEnv,
  getStorageDatabaseUrl,
  getStorageMode,
  parseStorageTables,
} from "../src/lib/storage-sync";

const ENV_NAMES = [
  "HASNA_MCPS_DATABASE_URL",
  "MCPS_DATABASE_URL",
  "HASNA_MCPS_STORAGE_MODE",
  "MCPS_STORAGE_MODE",
] as const;

const ORIGINAL_ENV = new Map<string, string | undefined>(
  ENV_NAMES.map((name) => [name, process.env[name]]),
);

describe("mcps storage sync configuration", () => {
  beforeEach(() => {
    for (const name of ENV_NAMES) delete process.env[name];
  });

  afterEach(() => {
    for (const name of ENV_NAMES) {
      const value = ORIGINAL_ENV.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("reads canonical storage database envs", () => {
    process.env["HASNA_MCPS_DATABASE_URL"] = "postgres://canonical";

    expect(getStorageDatabaseUrl()).toBe("postgres://canonical");
    expect(getStorageDatabaseEnv()).toEqual({
      name: "HASNA_MCPS_DATABASE_URL",
      deprecated: false,
    });
  });

  it("resolves local, hybrid, and remote storage modes", () => {
    expect(getStorageMode()).toBe("local");

    process.env["MCPS_DATABASE_URL"] = "postgres://remote";
    expect(getStorageMode()).toBe("hybrid");

    process.env["HASNA_MCPS_STORAGE_MODE"] = "remote";
    expect(getStorageMode()).toBe("remote");
  });

  it("parses and validates storage table filters", () => {
    expect(parseStorageTables()).toContain("servers");
    expect(parseStorageTables([" servers ", "tool_cache"])).toEqual(["servers", "tool_cache"]);
    expect(() => parseStorageTables(["missing"])).toThrow("Unknown mcps sync table");
  });

  it("exports storage helpers from the storage subpath source", async () => {
    const storage = await import("../src/storage.js");

    expect(storage.STORAGE_TABLES).toContain("servers");
    expect(storage.getStorageDatabaseUrl()).toBeNull();
    expect(storage.getStorageMode()).toBe("local");
    expect(storage.PG_MIGRATIONS.length).toBeGreaterThan(0);
    expect(typeof storage.PgAdapterAsync).toBe("function");
  });
});
