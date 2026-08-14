import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getStorageDatabaseUrl, getStorageMode, resolveTables, STORAGE_TABLES } from "./storage-sync.js";

const envKeys = [
  "HASNA_COMPUTER_DATABASE_URL",
  "COMPUTER_DATABASE_URL",
  "HASNA_COMPUTER_STORAGE_MODE",
  "COMPUTER_STORAGE_MODE",
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

describe("computer storage sync config", () => {
  test("canonical storage database env wins over fallback env", () => {
    process.env.HASNA_COMPUTER_DATABASE_URL = "postgres://new.example/computer";
    process.env.COMPUTER_DATABASE_URL = "postgres://fallback.example/computer";

    expect(getStorageDatabaseUrl()).toBe("postgres://new.example/computer");
    expect(getStorageMode()).toBe("hybrid");
  });

  test("fallback storage database env is accepted", () => {
    process.env.COMPUTER_DATABASE_URL = "postgres://fallback.example/computer";

    expect(getStorageDatabaseUrl()).toBe("postgres://fallback.example/computer");
    expect(getStorageMode()).toBe("hybrid");
  });

  test("canonical storage mode wins over fallback mode", () => {
    process.env.HASNA_COMPUTER_STORAGE_MODE = "remote";
    process.env.COMPUTER_STORAGE_MODE = "hybrid";

    expect(getStorageMode()).toBe("remote");
  });

  test("resolves storage tables", () => {
    expect(resolveTables()).toEqual([...STORAGE_TABLES]);
    expect(resolveTables(["feedback"])).toEqual(["feedback"]);
    expect(() => resolveTables(["missing"])).toThrow("Unknown computer sync table");
  });
});
