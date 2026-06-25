import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  BRAINS_STORAGE_FALLBACK_ENV,
  BRAINS_STORAGE_TABLES,
  STORAGE_TABLES,
  getStorageDatabaseEnvName,
  getStorageDatabaseUrl,
  getStorageMode,
  getStorageStatus,
  resolveTables,
} from "./storage-sync.js";

const envKeys = [
  "HASNA_BRAINS_DATABASE_URL",
  "BRAINS_DATABASE_URL",
  "HASNA_BRAINS_STORAGE_MODE",
  "BRAINS_STORAGE_MODE",
] as const;

const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  savedEnv.clear();
  for (const key of envKeys) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("brains storage sync config", () => {
  test("canonical storage database env wins over the short fallback", () => {
    process.env.HASNA_BRAINS_DATABASE_URL = "postgres://new.example/brains";
    process.env.BRAINS_DATABASE_URL = "postgres://fallback.example/brains";

    expect(getStorageDatabaseUrl()).toBe("postgres://new.example/brains");
    expect(getStorageDatabaseEnvName()).toBe("HASNA_BRAINS_DATABASE_URL");
    expect(getStorageMode()).toBe("hybrid");
  });

  test("short storage database env remains a non-deprecated fallback", () => {
    process.env.BRAINS_DATABASE_URL = "postgres://fallback.example/brains";

    expect(getStorageDatabaseUrl()).toBe("postgres://fallback.example/brains");
    expect(getStorageDatabaseEnvName()).toBe("BRAINS_DATABASE_URL");
    expect(getStorageMode()).toBe("hybrid");
  });

  test("canonical storage mode wins over the short fallback", () => {
    process.env.HASNA_BRAINS_STORAGE_MODE = "remote";
    process.env.BRAINS_STORAGE_MODE = "local";

    expect(getStorageMode()).toBe("remote");
  });

  test("publishes stable storage tables, fallback env, and redacted status", () => {
    process.env.BRAINS_DATABASE_URL = "postgres://user:secret@example.test/brains";

    const status = getStorageStatus();

    expect(BRAINS_STORAGE_TABLES).toEqual(STORAGE_TABLES);
    expect(BRAINS_STORAGE_FALLBACK_ENV.databaseUrl).toBe("BRAINS_DATABASE_URL");
    expect(status.service).toBe("brains");
    expect(status.tables).toEqual(STORAGE_TABLES);
    expect(status.env.databaseUrl.name).toBe("HASNA_BRAINS_DATABASE_URL");
    expect(status.env.databaseUrl.active_name).toBe("BRAINS_DATABASE_URL");
    expect(status.database.redacted_url).toBe("postgres://user:***@example.test/brains");
  });

  test("resolves storage tables", () => {
    expect(resolveTables()).toEqual([...STORAGE_TABLES]);
    expect(resolveTables(["feedback"])).toEqual(["feedback"]);
    expect(() => resolveTables(["missing"])).toThrow("Unknown brains sync table");
  });
});
