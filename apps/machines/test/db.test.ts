import { describe, expect, test } from "bun:test";
import { getDb } from "../src/db.js";

describe("database", () => {
  test("creates runtime tables", () => {
    const db = getDb(":memory:");
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((table) => table.name);
    expect(names).toContain("agent_heartbeats");
    expect(names).toContain("setup_runs");
    expect(names).toContain("sync_runs");
  });
});
