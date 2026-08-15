import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeDb } from "./database.js";
import { getStorageConfig, getStorageConnectionString, getStorageDatabaseEnvName } from "./storage-config.js";
import { getStorageStatus, parseStorageTables } from "./storage-sync.js";

const envKeys = [
  "HASNA_SEARCH_DATABASE_URL",
  "SEARCH_DATABASE_URL",
  "HASNA_SEARCH_STORAGE_MODE",
  "SEARCH_STORAGE_MODE",
] as const;

const savedEnv = new Map<string, string | undefined>();
let savedDbPath: string | undefined;

beforeEach(() => {
  savedDbPath = process.env.HASNA_SEARCH_DB_PATH;
  process.env.HASNA_SEARCH_DB_PATH = ":memory:";
  savedEnv.clear();
  for (const key of envKeys) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  closeDb();
  if (savedDbPath === undefined) delete process.env.HASNA_SEARCH_DB_PATH;
  else process.env.HASNA_SEARCH_DB_PATH = savedDbPath;
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("search storage config", () => {
  test("storage status reports repo-local search tables", () => {
    const status = getStorageStatus();

    expect(status.db_path).toBe(":memory:");
    expect(status.tables.map((table) => table.table)).toContain("searches");
    expect(status.tables.find((table) => table.table === "feedback")?.rows).toBe(0);
  });

  test("canonical storage database env wins over fallback env", () => {
    process.env.HASNA_SEARCH_DATABASE_URL = "postgres://new.example/search";
    process.env.SEARCH_DATABASE_URL = "postgres://fallback.example/search";

    expect(getStorageConnectionString()).toBe("postgres://new.example/search");
    expect(getStorageDatabaseEnvName()).toBe("HASNA_SEARCH_DATABASE_URL");
    expect(getStorageConfig().mode).toBe("hybrid");
  });

  test("service storage database env remains a fallback", () => {
    process.env.SEARCH_DATABASE_URL = "postgres://fallback.example/search";

    expect(getStorageConnectionString()).toBe("postgres://fallback.example/search");
    expect(getStorageDatabaseEnvName()).toBe("SEARCH_DATABASE_URL");
    expect(getStorageConfig().mode).toBe("hybrid");
  });

  test("canonical storage mode wins over fallback storage mode", () => {
    process.env.HASNA_SEARCH_STORAGE_MODE = "remote";
    process.env.SEARCH_STORAGE_MODE = "local";

    expect(getStorageConfig().mode).toBe("remote");
  });

  test("parses storage tables and rejects unknown tables", () => {
    expect(parseStorageTables("searches,feedback")).toEqual(["searches", "feedback"]);
    expect(() => parseStorageTables("missing")).toThrow("Unknown search storage table");
  });
});
