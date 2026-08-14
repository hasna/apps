import { describe, test, expect, beforeEach } from "bun:test";
import { SqliteAdapter as Database } from "./sqlite-adapter.js";
import { checkRateBudget, getRateBudget, cleanExpiredRateWindows, isRateExceeded, ensureRateTable } from "./rate.js";

function makeDb(): Database {
  const db = new Database(":memory:");
  // Agents table needed for active agent count
  db.run(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      session_id TEXT,
      role TEXT NOT NULL DEFAULT 'agent',
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  ensureRateTable(db);
  return db;
}

function addAgent(db: Database, id: string, active = true): void {
  const ts = active
    ? new Date().toISOString()
    : new Date(Date.now() - 31 * 60 * 1000).toISOString();
  db.run(
    "INSERT OR REPLACE INTO agents (id, name, session_id, role, last_seen_at, created_at) VALUES (?, ?, NULL, 'agent', ?, ?)",
    [id, id, ts, ts]
  );
}

describe("checkRateBudget", () => {
  test("solo agent gets full budget", () => {
    const db = makeDb();
    addAgent(db, "agent1");
    const result = checkRateBudget("agent1", "stripe", 100, true, db);
    expect(isRateExceeded(result)).toBe(false);
    if (!isRateExceeded(result)) {
      expect(result.budget).toBe(100); // 1 agent → full 100
      expect(result.active_agents).toBe(1);
      expect(result.used).toBe(1);
      expect(result.remaining).toBe(99);
    }
  });

  test("two agents split budget evenly", () => {
    const db = makeDb();
    addAgent(db, "agent1");
    addAgent(db, "agent2");
    const result = checkRateBudget("agent1", "stripe", 100, false, db);
    if (!isRateExceeded(result)) {
      expect(result.budget).toBe(50); // 2 agents → 50 each
      expect(result.active_agents).toBe(2);
    }
  });

  test("stale agents don't count toward active", () => {
    const db = makeDb();
    addAgent(db, "agent1", true);
    addAgent(db, "agent2", false); // stale
    const result = checkRateBudget("agent1", "stripe", 100, false, db);
    if (!isRateExceeded(result)) {
      expect(result.active_agents).toBe(1);
      expect(result.budget).toBe(100);
    }
  });

  test("consume=true increments counter", () => {
    const db = makeDb();
    addAgent(db, "agent1");
    checkRateBudget("agent1", "stripe", 100, true, db);
    checkRateBudget("agent1", "stripe", 100, true, db);
    const result = checkRateBudget("agent1", "stripe", 100, false, db);
    if (!isRateExceeded(result)) {
      expect(result.used).toBe(2);
    }
  });

  test("consume=false doesn't increment counter", () => {
    const db = makeDb();
    addAgent(db, "agent1");
    checkRateBudget("agent1", "stripe", 100, false, db);
    checkRateBudget("agent1", "stripe", 100, false, db);
    const result = checkRateBudget("agent1", "stripe", 100, false, db);
    if (!isRateExceeded(result)) {
      expect(result.used).toBe(0);
    }
  });

  test("returns RateExceededError when budget exhausted", () => {
    const db = makeDb();
    addAgent(db, "agent1");
    // Exhaust the budget (limit=3)
    checkRateBudget("agent1", "stripe", 3, true, db);
    checkRateBudget("agent1", "stripe", 3, true, db);
    checkRateBudget("agent1", "stripe", 3, true, db);
    const result = checkRateBudget("agent1", "stripe", 3, true, db);
    expect(isRateExceeded(result)).toBe(true);
    if (isRateExceeded(result)) {
      expect(result.exceeded).toBe(true);
      expect(result.budget).toBe(3);
      expect(result.used).toBe(3);
      expect(result.message).toContain("stripe");
    }
  });

  test("different connectors have independent budgets", () => {
    const db = makeDb();
    addAgent(db, "agent1");
    checkRateBudget("agent1", "stripe", 2, true, db);
    checkRateBudget("agent1", "stripe", 2, true, db);
    // stripe exhausted, github still available
    const githubResult = checkRateBudget("agent1", "github", 10, true, db);
    expect(isRateExceeded(githubResult)).toBe(false);
  });

  test("no agents registered defaults to 1 (solo budget)", () => {
    const db = makeDb();
    // No agents in DB at all
    const result = checkRateBudget("unknown", "stripe", 100, false, db);
    if (!isRateExceeded(result)) {
      expect(result.active_agents).toBe(1);
      expect(result.budget).toBe(100);
    }
  });

  test("budget is at least 1 even with many agents", () => {
    const db = makeDb();
    // Add 200 active agents
    for (let i = 0; i < 200; i++) addAgent(db, `a${i}`);
    const result = checkRateBudget("a0", "stripe", 10, false, db);
    if (!isRateExceeded(result)) {
      expect(result.budget).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("getRateBudget", () => {
  test("peeks without consuming", () => {
    const db = makeDb();
    addAgent(db, "agent1");
    getRateBudget("agent1", "stripe", 100, db);
    getRateBudget("agent1", "stripe", 100, db);
    const result = getRateBudget("agent1", "stripe", 100, db);
    if (!isRateExceeded(result)) {
      expect(result.used).toBe(0);
    }
  });
});

describe("cleanExpiredRateWindows", () => {
  test("cleans old windows", () => {
    const db = makeDb();
    ensureRateTable(db);
    // Insert an expired window
    const oldWindow = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    db.run("INSERT INTO connector_rate_usage VALUES (?, ?, ?, ?)", ["agent1", "stripe", oldWindow, 5]);
    const removed = cleanExpiredRateWindows(db);
    expect(removed).toBe(1);
  });
});

describe("isRateExceeded", () => {
  test("identifies exceeded objects", () => {
    expect(isRateExceeded({ exceeded: true, connector: "x", agent_id: "y", budget: 1, used: 1, active_agents: 1, window_resets_in_ms: 1000, message: "m" })).toBe(true);
  });
});
