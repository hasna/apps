import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, resetDatabase, closeDatabase } from "./database.js";
import { createTask, startTask, completeTask, failTask, addDependency } from "./tasks.js";
import { registerAgent } from "./agents.js";
import { patrolTasks, getReviewQueue } from "./patrol.js";
import type { Agent } from "../types/index.js";

describe("Patrol System", () => {
  let db: ReturnType<typeof getDatabase>;
  let agent: Agent;

  beforeEach(() => {
    process.env["TODOS_DB_PATH"] = ":memory:";
    resetDatabase();
    db = getDatabase();
    const result = registerAgent({ name: "testbot" }, db);
    if ("conflict" in result) throw new Error("unexpected conflict");
    agent = result;
  });

  afterEach(() => {
    closeDatabase();
  });

  describe("patrolTasks", () => {
    it("should detect stuck tasks", () => {
      const t = createTask({ title: "Stuck task" }, db);
      startTask(t.id, agent.id, db);
      // Manually backdate updated_at to simulate stuck
      db.run("UPDATE tasks SET updated_at = datetime('now', '-2 hours') WHERE id = ?", [t.id]);
      const result = patrolTasks({ stuck_minutes: 60 }, db);
      expect(result.issues.some(i => i.type === "stuck" && i.task_id === t.id)).toBe(true);
    });

    it("should detect low confidence completions", () => {
      const t = createTask({ title: "Low conf task" }, db);
      startTask(t.id, agent.id, db);
      completeTask(t.id, agent.id, db, { confidence: 0.2 });
      const result = patrolTasks({ confidence_threshold: 0.5 }, db);
      expect(result.issues.some(i => i.type === "low_confidence" && i.task_id === t.id)).toBe(true);
    });

    it("should detect orphaned tasks", () => {
      const t = createTask({ title: "Orphaned task" }, db);
      // Task with no project, no agent, no assignee = orphaned
      const result = patrolTasks({}, db);
      expect(result.issues.some(i => i.type === "orphaned" && i.task_id === t.id)).toBe(true);
    });

    it("should detect tasks needing review", () => {
      const t = createTask({ title: "Review me", requires_approval: true }, db);
      startTask(t.id, agent.id, db);
      completeTask(t.id, agent.id, db);
      const result = patrolTasks({}, db);
      expect(result.issues.some(i => i.type === "needs_review" && i.task_id === t.id)).toBe(true);
    });

    it("should detect zombie blocked tasks", () => {
      const blocker = createTask({ title: "Blocker" }, db);
      const blocked = createTask({ title: "Blocked by dead task" }, db);
      addDependency(blocked.id, blocker.id, db);
      startTask(blocker.id, agent.id, db);
      failTask(blocker.id, agent.id, "failed", undefined, db);
      const result = patrolTasks({}, db);
      expect(result.issues.some(i => i.type === "zombie_blocked" && i.task_id === blocked.id)).toBe(true);
    });

    it("should return empty when no issues", () => {
      const t = createTask({ title: "Good task" }, db);
      startTask(t.id, agent.id, db);
      completeTask(t.id, agent.id, db, { confidence: 0.9 });
      const result = patrolTasks({}, db);
      expect(result.issues.filter(i => i.task_id === t.id)).toHaveLength(0);
    });

    it("should sort by severity", () => {
      // Create tasks that trigger different severity issues
      const stuck = createTask({ title: "Stuck" }, db);
      startTask(stuck.id, agent.id, db);
      db.run("UPDATE tasks SET updated_at = datetime('now', '-10 hours') WHERE id = ?", [stuck.id]);

      const orphan = createTask({ title: "Orphan" }, db);

      const result = patrolTasks({ stuck_minutes: 60 }, db);
      expect(result.issues.length).toBeGreaterThanOrEqual(2);
      // Critical/high severity should come first
      const severities = result.issues.map(i => i.severity);
      const order = { critical: 0, high: 1, medium: 2, low: 3 };
      for (let i = 1; i < severities.length; i++) {
        expect(order[severities[i]!]).toBeGreaterThanOrEqual(order[severities[i - 1]!]);
      }
    });
  });

  describe("getReviewQueue", () => {
    it("should return tasks needing approval", () => {
      const t = createTask({ title: "Need approval", requires_approval: true }, db);
      startTask(t.id, agent.id, db);
      completeTask(t.id, agent.id, db);
      const queue = getReviewQueue({}, db);
      expect(queue.some(q => q.id === t.id)).toBe(true);
    });

    it("should return low-confidence tasks", () => {
      const t = createTask({ title: "Low conf" }, db);
      startTask(t.id, agent.id, db);
      completeTask(t.id, agent.id, db, { confidence: 0.3 });
      const queue = getReviewQueue({}, db);
      expect(queue.some(q => q.id === t.id)).toBe(true);
    });

    it("should respect limit", () => {
      for (let i = 0; i < 5; i++) {
        const t = createTask({ title: `Low conf ${i}` }, db);
        startTask(t.id, agent.id, db);
        completeTask(t.id, agent.id, db, { confidence: 0.2 });
      }
      const queue = getReviewQueue({ limit: 3 }, db);
      expect(queue.length).toBe(3);
    });
  });
});
