import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, resetDatabase, closeDatabase } from "./database.js";
import { createTask, startTask, completeTask, failTask } from "./tasks.js";
import { registerAgent } from "./agents.js";
import { matchCapabilities, getCapableAgents } from "./agents.js";
import { getAgentMetrics, getLeaderboard, scoreTask } from "./agent-metrics.js";
import type { Agent } from "../types/index.js";

describe("Agent Capabilities", () => {
  describe("matchCapabilities", () => {
    it("should return 1.0 for empty requirements", () => {
      expect(matchCapabilities(["a", "b"], [])).toBe(1.0);
    });

    it("should return 0.0 for empty agent capabilities", () => {
      expect(matchCapabilities([], ["a", "b"])).toBe(0.0);
    });

    it("should return correct score for partial match", () => {
      expect(matchCapabilities(["a", "b"], ["a", "c"])).toBe(0.5);
    });

    it("should return 1.0 for perfect match", () => {
      expect(matchCapabilities(["a", "b", "c"], ["a", "b"])).toBe(1.0);
    });

    it("should be case insensitive", () => {
      expect(matchCapabilities(["TypeScript", "Testing"], ["typescript", "testing"])).toBe(1.0);
    });
  });

  describe("getCapableAgents", () => {
    let db: ReturnType<typeof getDatabase>;

    beforeEach(() => {
      process.env["TODOS_DB_PATH"] = ":memory:";
      resetDatabase();
      db = getDatabase();
    });

    afterEach(() => {
      closeDatabase();
    });

    it("should find agents with matching capabilities", () => {
      const a1 = registerAgent({ name: "devbot", capabilities: ["typescript", "testing"] }, db);
      const a2 = registerAgent({ name: "opsbot", capabilities: ["devops", "kubernetes"] }, db);
      if ("conflict" in a1 || "conflict" in a2) throw new Error("conflict");

      const results = getCapableAgents(["typescript"], {}, db);
      expect(results.length).toBe(1);
      expect(results[0]!.agent.name).toBe("devbot");
      expect(results[0]!.score).toBe(1.0);
    });

    it("should sort by score", () => {
      registerAgent({ name: "botA", capabilities: ["typescript", "testing", "devops"] }, db);
      registerAgent({ name: "botB", capabilities: ["typescript"] }, db);
      const results = getCapableAgents(["typescript", "testing"], {}, db);
      expect(results[0]!.agent.name).toBe("bota");
      expect(results[0]!.score).toBe(1.0);
      expect(results[1]!.score).toBe(0.5);
    });

    it("should filter by min_score", () => {
      registerAgent({ name: "botA", capabilities: ["typescript", "testing"] }, db);
      registerAgent({ name: "botB", capabilities: ["python"] }, db);
      const results = getCapableAgents(["typescript", "testing"], { min_score: 0.5 }, db);
      expect(results.length).toBe(1);
    });
  });
});

describe("Agent Metrics", () => {
  let db: ReturnType<typeof getDatabase>;
  let agent: Agent;

  beforeEach(() => {
    process.env["TODOS_DB_PATH"] = ":memory:";
    resetDatabase();
    db = getDatabase();
    const result = registerAgent({ name: "metricbot" }, db);
    if ("conflict" in result) throw new Error("conflict");
    agent = result;
  });

  afterEach(() => {
    closeDatabase();
  });

  describe("getAgentMetrics", () => {
    it("should return null for unknown agent", () => {
      expect(getAgentMetrics("unknown-agent", {}, db)).toBeNull();
    });

    it("should compute correct metrics", () => {
      // Create and complete some tasks
      for (let i = 0; i < 3; i++) {
        const t = createTask({ title: `Task ${i}`, agent_id: agent.id }, db);
        startTask(t.id, agent.id, db);
        completeTask(t.id, agent.id, db, { confidence: 0.8 });
      }
      // Create and fail one
      const f = createTask({ title: "Failed", agent_id: agent.id }, db);
      startTask(f.id, agent.id, db);
      failTask(f.id, agent.id, "test", undefined, db);

      const metrics = getAgentMetrics(agent.id, {}, db);
      expect(metrics).not.toBeNull();
      expect(metrics!.tasks_completed).toBe(3);
      expect(metrics!.tasks_failed).toBe(1);
      expect(metrics!.completion_rate).toBe(0.75);
      expect(metrics!.avg_confidence).toBe(0.8);
    });

    it("should resolve by name", () => {
      const t = createTask({ title: "Test", agent_id: agent.id }, db);
      startTask(t.id, agent.id, db);
      completeTask(t.id, agent.id, db);

      const metrics = getAgentMetrics("metricbot", {}, db);
      expect(metrics).not.toBeNull();
      expect(metrics!.tasks_completed).toBe(1);
    });
  });

  describe("scoreTask", () => {
    it("should store review score in metadata", () => {
      const t = createTask({ title: "Scored task", agent_id: agent.id }, db);
      startTask(t.id, agent.id, db);
      completeTask(t.id, agent.id, db);
      scoreTask(t.id, 0.9, agent.id, db);

      const row = db.query("SELECT metadata FROM tasks WHERE id = ?").get(t.id) as { metadata: string };
      const meta = JSON.parse(row.metadata);
      expect(meta._review_score).toBe(0.9);
      expect(meta._reviewed_by).toBe(agent.id);
    });

    it("should reject invalid scores", () => {
      const t = createTask({ title: "Test" }, db);
      expect(() => scoreTask(t.id, 1.5, undefined, db)).toThrow("Score must be between 0 and 1");
      expect(() => scoreTask(t.id, -0.1, undefined, db)).toThrow("Score must be between 0 and 1");
    });
  });

  describe("getLeaderboard", () => {
    it("should rank agents by composite score", () => {
      const r2 = registerAgent({ name: "slacker" }, db);
      if ("conflict" in r2) throw new Error("conflict");
      const agent2 = r2;

      // Agent 1: 3 completed
      for (let i = 0; i < 3; i++) {
        const t = createTask({ title: `A1 Task ${i}`, agent_id: agent.id }, db);
        startTask(t.id, agent.id, db);
        completeTask(t.id, agent.id, db, { confidence: 0.9 });
      }

      // Agent 2: 1 completed, 1 failed
      const t1 = createTask({ title: "A2 Task 1", agent_id: agent2.id }, db);
      startTask(t1.id, agent2.id, db);
      completeTask(t1.id, agent2.id, db, { confidence: 0.5 });
      const t2 = createTask({ title: "A2 Task 2", agent_id: agent2.id }, db);
      startTask(t2.id, agent2.id, db);
      failTask(t2.id, agent2.id, "test", undefined, db);

      const leaderboard = getLeaderboard({}, db);
      expect(leaderboard.length).toBe(2);
      expect(leaderboard[0]!.rank).toBe(1);
      expect(leaderboard[0]!.agent_name).toBe("metricbot");
      expect(leaderboard[1]!.rank).toBe(2);
      expect(leaderboard[1]!.agent_name).toBe("slacker");
    });

    it("should filter by project", () => {
      const leaderboard = getLeaderboard({ project_id: "nonexistent" }, db);
      expect(leaderboard).toHaveLength(0);
    });
  });
});
