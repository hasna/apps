import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  LEGACY_STORAGE_MODE_ENV,
  STORAGE_DATABASE_ENV,
  assertNoLegacyStorageMode,
  getStorageBackend,
  getStorageDatabaseUrl,
} from "./storage-config.js";
import { STORAGE_TABLES, getStorageStatus, parseStorageTables } from "./storage-sync.js";

const ENV_NAMES = [
  ...STORAGE_DATABASE_ENV,
  ...LEGACY_STORAGE_MODE_ENV,
] as const;

beforeAll(() => {
  process.env.BRAINS_DB_PATH = ":memory:";
});

afterAll(() => {
  delete process.env.BRAINS_DB_PATH;
});

afterEach(() => {
  for (const name of ENV_NAMES) {
    delete process.env[name];
  }
});

describe("brains storage configuration", () => {
  test("reads canonical storage database envs", () => {
    process.env["HASNA_BRAINS_DATABASE_URL"] = "postgres://new.example/brains";

    expect(getStorageDatabaseUrl()).toBe("postgres://new.example/brains");
  });

  test("rejects any retired storage-mode variable instead of treating it as a selector", () => {
    for (const key of LEGACY_STORAGE_MODE_ENV) {
      process.env[key] = "remote";
      expect(() => assertNoLegacyStorageMode()).toThrow(new RegExp(key));
      expect(() => getStorageBackend()).toThrow(new RegExp(key));
      delete process.env[key];
    }
  });

  test("a blank retired storage-mode variable still throws", () => {
    process.env["HASNA_BRAINS_STORAGE_MODE"] = "";
    expect(() => getStorageBackend()).toThrow(/HASNA_BRAINS_STORAGE_MODE/);
  });

  test("selects the server backend by DATABASE_URL presence", () => {
    expect(getStorageBackend()).toBe("sqlite");

    process.env["HASNA_BRAINS_DATABASE_URL"] = "postgres://new.example/brains";
    expect(getStorageBackend()).toBe("postgresql");
  });

  test("returns all storage tables by default", () => {
    expect(parseStorageTables()).toEqual([...STORAGE_TABLES]);
    expect(parseStorageTables("fine_tuned_models,feedback")).toEqual(["fine_tuned_models", "feedback"]);
  });

  test("status reports repo-local brains tables through storage", () => {
    const status = getStorageStatus();

    expect(status.backend).toBe("sqlite");
    expect(status.enabled).toBe(false);
    expect(status.db_path).toBe(":memory:");
    expect(status.tables.map((table) => table.table)).toContain("fine_tuned_models");
    expect(status.tables.find((table) => table.table === "feedback")?.rows).toBe(0);
  });
});
