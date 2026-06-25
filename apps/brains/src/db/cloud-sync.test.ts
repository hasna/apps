process.env.BRAINS_DB_PATH = ":memory:";

import { afterEach, describe, expect, test } from "bun:test";
import {
  DEPRECATED_CLOUD_DATABASE_ENV,
  DEPRECATED_CLOUD_MODE_ENV,
  STORAGE_DATABASE_ENV,
  STORAGE_MODE_ENV,
  getCloudDatabaseUrl,
  getStorageConfig,
  getStorageDatabaseUrl,
} from "./cloud-config.js";
import { STORAGE_TABLES, getCloudStatus, getStorageStatus, parseStorageTables } from "./cloud-sync.js";

const ENV_NAMES = [
  ...STORAGE_DATABASE_ENV,
  ...DEPRECATED_CLOUD_DATABASE_ENV,
  ...STORAGE_MODE_ENV,
  ...DEPRECATED_CLOUD_MODE_ENV,
] as const;

afterEach(() => {
  for (const name of ENV_NAMES) {
    delete process.env[name];
  }
});

describe("brains storage configuration", () => {
  test("prefers canonical storage database envs over deprecated cloud aliases", () => {
    process.env["HASNA_BRAINS_DATABASE_URL"] = "postgres://new.example/brains";
    process.env["HASNA_BRAINS_CLOUD_DATABASE_URL"] = "postgres://old.example/brains";

    expect(getStorageDatabaseUrl()).toBe("postgres://new.example/brains");
    expect(getCloudDatabaseUrl()).toBe("postgres://new.example/brains");
  });

  test("keeps deprecated cloud database envs as migration aliases", () => {
    process.env["OPEN_BRAINS_CLOUD_DATABASE_URL"] = "postgres://old.example/brains";

    expect(getStorageDatabaseUrl()).toBe("postgres://old.example/brains");
  });

  test("maps legacy cloud mode to remote storage mode", () => {
    process.env["HASNA_BRAINS_CLOUD_MODE"] = "cloud";

    expect(getStorageConfig().mode).toBe("remote");
  });

  test("returns all storage tables by default", () => {
    expect(parseStorageTables()).toEqual([...STORAGE_TABLES]);
    expect(parseStorageTables("fine_tuned_models,feedback")).toEqual(["fine_tuned_models", "feedback"]);
  });

  test("status reports repo-local brains tables through storage and cloud aliases", () => {
    const status = getStorageStatus();
    const aliasStatus = getCloudStatus();

    expect(status.db_path).toBe(":memory:");
    expect(status.tables.map((table) => table.table)).toContain("fine_tuned_models");
    expect(status.tables.find((table) => table.table === "feedback")?.rows).toBe(0);
    expect(aliasStatus.tables.map((table) => table.table)).toEqual(status.tables.map((table) => table.table));
  });
});
