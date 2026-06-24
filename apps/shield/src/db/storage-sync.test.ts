import { afterEach, describe, expect, test } from "bun:test";
import {
  SECURITY_STORAGE_FALLBACK_ENV,
  SECURITY_STORAGE_ENV,
  STORAGE_DATABASE_ENV,
  STORAGE_MODE_ENV,
  getStorageConfig,
  getStorageDatabaseEnvName,
  getStorageDatabaseUrl,
} from "./storage-config.js";
import { SECURITY_STORAGE_TABLES, STORAGE_TABLES, parseStorageTables } from "./storage-sync.js";

const ENV_NAMES = [
  ...STORAGE_DATABASE_ENV,
  ...STORAGE_MODE_ENV,
] as const;

afterEach(() => {
  for (const name of ENV_NAMES) {
    delete process.env[name];
  }
});

describe("shield storage configuration", () => {
  test("prefers canonical storage database envs over the short fallback", () => {
    process.env["HASNA_SECURITY_DATABASE_URL"] = "postgres://new.example/security";
    process.env["SECURITY_DATABASE_URL"] = "postgres://fallback.example/security";

    expect(getStorageDatabaseUrl()).toBe("postgres://new.example/security");
    expect(getStorageDatabaseEnvName()).toBe("HASNA_SECURITY_DATABASE_URL");
  });

  test("keeps short storage database env as a non-deprecated fallback", () => {
    process.env["SECURITY_DATABASE_URL"] = "postgres://fallback.example/security";

    expect(getStorageDatabaseUrl()).toBe("postgres://fallback.example/security");
    expect(getStorageDatabaseEnvName()).toBe("SECURITY_DATABASE_URL");
  });

  test("canonical storage mode wins over short fallback", () => {
    process.env["HASNA_SECURITY_STORAGE_MODE"] = "remote";
    process.env["SECURITY_STORAGE_MODE"] = "local";

    expect(getStorageConfig().mode).toBe("remote");
  });

  test("returns all storage tables by default", () => {
    expect(SECURITY_STORAGE_ENV.databaseUrl).toBe("HASNA_SECURITY_DATABASE_URL");
    expect(SECURITY_STORAGE_FALLBACK_ENV.databaseUrl).toBe("SECURITY_DATABASE_URL");
    expect(SECURITY_STORAGE_TABLES).toEqual(STORAGE_TABLES);
    expect(parseStorageTables()).toEqual([...STORAGE_TABLES]);
    expect(parseStorageTables("projects,findings")).toEqual(["projects", "findings"]);
  });
});
