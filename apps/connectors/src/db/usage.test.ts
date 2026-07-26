import { describe, test, expect } from "bun:test";
import { SqliteAdapter as Database } from "./sqlite-adapter.js";
import { logUsage, getUsageStats, getTopConnectors, getUsageMap, cleanOldUsage } from "./usage.js";

function makeDb(): Database {
  const db = new Database(":memory:");
  db.run(`CREATE TABLE IF NOT EXISTS connector_usage (
    id TEXT PRIMARY KEY, connector TEXT NOT NULL, action TEXT NOT NULL,
    agent_id TEXT, timestamp TEXT NOT NULL
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_usage_connector ON connector_usage(connector, timestamp DESC)`);
  return db;
}

describe("logUsage", () => {
  test("inserts a usage record", () => {
    const db = makeDb();
    logUsage("stripe", "run", "agent1", db);
    const count = (db.query("SELECT COUNT(*) as c FROM connector_usage").get() as { c: number }).c;
    expect(count).toBe(1);
  });

  test("logs without agent_id", () => {
    const db = makeDb();
    logUsage("github", "docs", undefined, db);
    const row = db.query("SELECT * FROM connector_usage").get() as { agent_id: string | null };
    expect(row.agent_id).toBeNull();
  });
});

describe("getUsageStats", () => {
  test("returns stats for a connector", () => {
    const db = makeDb();
    logUsage("stripe", "run", undefined, db);
    logUsage("stripe", "docs", undefined, db);
    logUsage("stripe", "run", undefined, db);
    const stats = getUsageStats("stripe", db);
    expect(stats.total).toBe(3);
    expect(stats.last7d).toBe(3);
    expect(stats.last24h).toBe(3);
  });

  test("returns zeros for unused connector", () => {
    const db = makeDb();
    const stats = getUsageStats("unused", db);
    expect(stats.total).toBe(0);
  });
});

describe("getTopConnectors", () => {
  test("ranks by usage count", () => {
    const db = makeDb();
    logUsage("stripe", "run", undefined, db);
    logUsage("stripe", "run", undefined, db);
    logUsage("stripe", "run", undefined, db);
    logUsage("github", "run", undefined, db);
    const top = getTopConnectors(10, 7, db);
    expect(top[0].connector).toBe("stripe");
    expect(top[0].count).toBe(3);
    expect(top[1].connector).toBe("github");
    expect(top[1].count).toBe(1);
  });

  test("respects limit", () => {
    const db = makeDb();
    logUsage("a", "run", undefined, db);
    logUsage("b", "run", undefined, db);
    logUsage("c", "run", undefined, db);
    expect(getTopConnectors(2, 7, db)).toHaveLength(2);
  });
});

describe("getUsageMap", () => {
  test("returns Map of connector → count", () => {
    const db = makeDb();
    logUsage("stripe", "run", undefined, db);
    logUsage("stripe", "run", undefined, db);
    const map = getUsageMap(7, db);
    expect(map.get("stripe")).toBe(2);
  });
});

describe("cleanOldUsage", () => {
  test("removes old records", () => {
    const db = makeDb();
    // Insert an old record
    db.run("INSERT INTO connector_usage (id, connector, action, timestamp) VALUES (?, ?, ?, ?)",
      ["old1", "stripe", "run", new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()]);
    logUsage("github", "run", undefined, db); // recent
    const removed = cleanOldUsage(30, db);
    expect(removed).toBe(1);
    const remaining = (db.query("SELECT COUNT(*) as c FROM connector_usage").get() as { c: number }).c;
    expect(remaining).toBe(1);
  });
});
