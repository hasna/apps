import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeDatabase, resetDatabase } from "./database.js";
import {
  getStorageDatabaseEnv,
  getStorageDatabaseUrl,
  getStorageMode,
  getStorageStatus,
  parseStorageTables,
  resolveTables,
  STORAGE_TABLES,
} from "./storage-sync.js";

const envKeys = [
  "HASNA_CALENDAR_DATABASE_URL",
  "CALENDAR_DATABASE_URL",
  "HASNA_CALENDAR_STORAGE_MODE",
  "CALENDAR_STORAGE_MODE",
  "CALENDAR_DB_PATH",
  "BUN_TEST",
] as const;

const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  savedEnv.clear();
  for (const key of envKeys) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
  process.env["CALENDAR_DB_PATH"] = ":memory:";
  resetDatabase();
});

afterEach(() => {
  closeDatabase();
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("calendar storage sync config", () => {
  test("canonical storage database env wins over fallback env", () => {
    process.env["HASNA_CALENDAR_DATABASE_URL"] = "postgres://new.example/calendar";
    process.env["CALENDAR_DATABASE_URL"] = "postgres://fallback.example/calendar";

    expect(getStorageDatabaseUrl()).toBe("postgres://new.example/calendar");
    expect(getStorageDatabaseEnv()).toEqual({ name: "HASNA_CALENDAR_DATABASE_URL" });
    expect(getStorageMode()).toBe("hybrid");
  });

  test("fallback storage database env is accepted", () => {
    process.env["CALENDAR_DATABASE_URL"] = "postgres://fallback.example/calendar";

    expect(getStorageDatabaseUrl()).toBe("postgres://fallback.example/calendar");
    expect(getStorageDatabaseEnv()).toEqual({ name: "CALENDAR_DATABASE_URL" });
    expect(getStorageMode()).toBe("hybrid");
  });

  test("canonical storage mode wins over fallback mode", () => {
    process.env["HASNA_CALENDAR_STORAGE_MODE"] = "remote";
    process.env["CALENDAR_STORAGE_MODE"] = "hybrid";

    expect(getStorageMode()).toBe("remote");
  });

  test("resolves storage tables", () => {
    expect(resolveTables()).toEqual([...STORAGE_TABLES]);
    expect(resolveTables(["events", "event_attendees"])).toEqual(["events", "event_attendees"]);
    expect(parseStorageTables("events, event_attendees")).toEqual(["events", "event_attendees"]);
    expect(() => resolveTables(["missing"])).toThrow("Unknown calendar sync table");
  });

  test("status reports local mode and sync table state", () => {
    const status = getStorageStatus();

    expect(status.configured).toBe(false);
    expect(status.mode).toBe("local");
    expect(status.activeEnv).toBe(null);
    expect(status.service).toBe("calendar");
    expect(status.tables).toContain("events");
    expect(status.sync).toEqual([]);
  });
});
