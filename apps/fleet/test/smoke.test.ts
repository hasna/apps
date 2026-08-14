import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resolveStorageMode, databaseUrlPresent } from "../src/config.js";
import { health } from "../src/server/health.js";
import { getDatabase } from "../src/db/database.js";
import { cleanupTestDatabase, useTestDatabase } from "./helpers/database.js";

let dbPath: string;

beforeEach(() => {
  dbPath = useTestDatabase("fleet-smoke");
});

afterEach(() => {
  cleanupTestDatabase(dbPath);
});

describe("config storage mode", () => {
  it("defaults to local", () => {
    expect(resolveStorageMode({})).toBe("local");
  });

  it("normalizes deprecated aliases to cloud", () => {
    expect(resolveStorageMode({ HASNA_FLEET_STORAGE_MODE: "self_hosted" })).toBe("cloud");
    expect(resolveStorageMode({ HASNA_FLEET_STORAGE_MODE: "cloud", HASNA_FLEET_DATABASE_URL: "x" })).toBe("cloud");
  });

  it("rejects unknown storage modes", () => {
    expect(() => resolveStorageMode({ HASNA_FLEET_STORAGE_MODE: "hybrid-cache" })).toThrow();
  });

  it("fails closed when a DSN is present but mode resolves to local", () => {
    expect(() => resolveStorageMode({ HASNA_FLEET_DATABASE_URL: "postgres://x" })).toThrow(/misconfiguration/);
  });

  it("detects DSN presence without reading its value", () => {
    expect(databaseUrlPresent({})).toBe(false);
    expect(databaseUrlPresent({ HASNA_FLEET_DATABASE_URL: "postgres://secret" })).toBe(true);
  });
});

describe("health + db", () => {
  it("returns the { status, version, mode } contract shape", () => {
    const h = health();
    expect(h.status).toBe("ok");
    expect(h.mode).toBe("local");
    expect(typeof h.version).toBe("string");
  });

  it("opens the database and applies migrations", () => {
    const db = getDatabase();
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("slos");
    expect(names).toContain("fleet_audit");
    expect(names).toContain("schema_migrations");
  });
});
