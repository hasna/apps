process.env.BRAINS_DB_PATH = ":memory:";

import { afterEach, describe, expect, test } from "bun:test";
import {
  STORAGE_DATABASE_ENV,
  STORAGE_MODE_ENV,
  getStorageConfig,
  getStorageDatabaseUrl,
} from "./storage-config.js";
import { STORAGE_TABLES, getStorageStatus, parseStorageTables } from "./storage-sync.js";

const ENV_NAMES = [
  ...STORAGE_DATABASE_ENV,
  ...STORAGE_MODE_ENV,
] as const;

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

  test("uses canonical storage mode envs", () => {
    process.env["HASNA_BRAINS_STORAGE_MODE"] = "remote";

    expect(getStorageConfig().mode).toBe("remote");
  });

  test("returns all storage tables by default", () => {
    expect(parseStorageTables()).toEqual([...STORAGE_TABLES]);
    expect(parseStorageTables("fine_tuned_models,feedback")).toEqual(["fine_tuned_models", "feedback"]);
  });

  test("status reports repo-local brains tables through storage", () => {
    const status = getStorageStatus();

    expect(status.db_path).toBe(":memory:");
    expect(status.tables.map((table) => table.table)).toContain("fine_tuned_models");
    expect(status.tables.find((table) => table.table === "feedback")?.rows).toBe(0);
  });
});
