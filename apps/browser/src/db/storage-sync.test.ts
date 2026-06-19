import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getStorageDatabaseEnvName, getStorageDatabaseUrl, getStorageMode, resolveTables, STORAGE_TABLES } from "./storage-sync.js";

const envKeys = [
  "HASNA_BROWSER_DATABASE_URL",
  "BROWSER_DATABASE_URL",
  "HASNA_BROWSER_STORAGE_MODE",
  "BROWSER_STORAGE_MODE",
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

describe("browser storage sync config", () => {
  test("canonical storage database env wins over fallback env", () => {
    process.env.HASNA_BROWSER_DATABASE_URL = "postgres://new.example/browser";
    process.env.BROWSER_DATABASE_URL = "postgres://fallback.example/browser";

    expect(getStorageDatabaseUrl()).toBe("postgres://new.example/browser");
    expect(getStorageDatabaseEnvName()).toBe("HASNA_BROWSER_DATABASE_URL");
    expect(getStorageMode()).toBe("hybrid");
  });

  test("service storage database env remains a fallback", () => {
    process.env.BROWSER_DATABASE_URL = "postgres://fallback.example/browser";

    expect(getStorageDatabaseUrl()).toBe("postgres://fallback.example/browser");
    expect(getStorageDatabaseEnvName()).toBe("BROWSER_DATABASE_URL");
    expect(getStorageMode()).toBe("hybrid");
  });

  test("canonical storage mode wins over fallback storage mode", () => {
    process.env.HASNA_BROWSER_STORAGE_MODE = "remote";
    process.env.BROWSER_STORAGE_MODE = "local";

    expect(getStorageMode()).toBe("remote");
  });

  test("resolves storage tables", () => {
    expect(resolveTables()).toEqual([...STORAGE_TABLES]);
    expect(resolveTables(["feedback"])).toEqual(["feedback"]);
    expect(() => resolveTables(["missing"])).toThrow("Unknown browser sync table");
  });
});
