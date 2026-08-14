import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTask, startTask, lockTask } from "../db/tasks.js";
import {
  acquireTaskLease,
  renewTaskLease,
  releaseTaskLease,
  stealTaskLease,
  recoverStaleLeases,
  listActiveLeases,
  formatLockConflict,
} from "./agent-coordination.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("agent coordination leases", () => {
  it("acquires and renews a lease", () => {
    const task = createTask({ title: "Lease task" });
    const result = acquireTaskLease(task.id, "agent-a", 30);
    expect(result.success).toBe(true);
    expect(result.lease?.agent_id).toBe("agent-a");

    const renewed = renewTaskLease(task.id, "agent-a", 45);
    expect(renewed.agent_id).toBe("agent-a");
    expect(listActiveLeases("agent-a")).toHaveLength(1);
  });

  it("denies conflicting lease with clear message", () => {
    const task = createTask({ title: "Contested" });
    acquireTaskLease(task.id, "agent-a");
    const result = acquireTaskLease(task.id, "agent-b");
    expect(result.success).toBe(false);
    expect(result.conflict?.message).toContain("agent-a");
  });

  it("releases lease safely", () => {
    const task = createTask({ title: "Release" });
    acquireTaskLease(task.id, "agent-a");
    expect(releaseTaskLease(task.id, "agent-a")).toBe(true);
    expect(listActiveLeases()).toHaveLength(0);
  });

  it("steals stale lease", () => {
    const task = createTask({ title: "Stale" });
    startTask(task.id, "agent-old");
    lockTask(task.id, "agent-old");

    const stolen = stealTaskLease(task.id, "agent-new", { stale_minutes: 0, force: true });
    expect(stolen.success).toBe(true);
    expect(stolen.lease?.steal_count).toBeGreaterThan(0);
  });

  it("recovers expired leases", () => {
    const task = createTask({ title: "Expired" });
    acquireTaskLease(task.id, "agent-a", -1 / 60); // negative ttl = already expired
    const db = getDatabase();
    db.run("UPDATE task_leases SET expires_at = ? WHERE task_id = ?", [new Date(Date.now() - 1000).toISOString(), task.id]);

    const result = recoverStaleLeases();
    expect(result.recovered.length).toBeGreaterThan(0);
  });

  it("formats lock conflicts deterministically", () => {
    const msg = formatLockConflict("abc-123", "agent-x", "2026-01-01T00:00:00Z");
    expect(msg.message).toContain("agent-x");
  });
});
