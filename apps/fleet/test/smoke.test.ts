import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resolveServerBackend, databaseUrlPresent } from "../src/config.js";
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

describe("config server data backend", () => {
  it("defaults to sqlite", () => {
    expect(resolveServerBackend({})).toBe("sqlite");
  });

  it("resolves the postgresql backend when a DATABASE_URL is present", () => {
    expect(resolveServerBackend({ HASNA_FLEET_DATABASE_URL: "postgres://x" })).toBe("postgresql");
    expect(resolveServerBackend({ FLEET_DATABASE_URL: "postgres://x" })).toBe("postgresql");
  });

  it("ignores the retired HASNA_FLEET_STORAGE_MODE variable", () => {
    expect(resolveServerBackend({ HASNA_FLEET_STORAGE_MODE: "self_hosted" })).toBe("sqlite");
    expect(resolveServerBackend({ HASNA_FLEET_STORAGE_MODE: "cloud" })).toBe("sqlite");
  });

  it("detects DSN presence without reading its value", () => {
    expect(databaseUrlPresent({})).toBe(false);
    expect(databaseUrlPresent({ HASNA_FLEET_DATABASE_URL: "postgres://secret" })).toBe(true);
  });
});

describe("health + db", () => {
  it("returns the { status, version, backend } contract shape", () => {
    const h = health();
    expect(h.status).toBe("ok");
    expect(h.backend).toBe("sqlite");
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
