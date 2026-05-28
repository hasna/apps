import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, resetDatabase, closeDatabase } from "./database.js";
import { createTask, startTask, completeTask, failTask } from "./tasks.js";
import { registerAgent } from "./agents.js";
import { matchCapabilities, getCapableAgents } from "./agents.js";
import {
  createAgentReliabilityExport,
  getAgentMetrics,
  getAgentReliabilityScorecard,
  getLeaderboard,
  listAgentReliabilityScorecards,
  renderAgentReliabilityMarkdown,
  scoreTask,
} from "./agent-metrics.js";
import { createHandoff } from "./handoffs.js";
import { createProject } from "./projects.js";
import { addTaskVerification } from "./task-commits.js";
import { addTaskRunCommand, finishTaskRun, startTaskRun } from "./task-runs.js";
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

  describe("agent reliability scorecards", () => {
    it("scores agents from local tasks, failed runs, verification evidence, stale locks, handoffs, and retries", () => {
      const project = createProject({ name: "Reliability", path: "/tmp/reliability" }, db);
      const completed = createTask({ title: "Completed with evidence", project_id: project.id, agent_id: agent.id }, db);
      startTask(completed.id, agent.id, db);
      completeTask(completed.id, agent.id, db, { confidence: 0.9 });
      addTaskVerification({
        task_id: completed.id,
        command: "bun test",
        status: "passed",
        output_summary: "green",
        agent_id: agent.id,
      }, db);

      const failed = createTask({ title: "Failed implementation", project_id: project.id, agent_id: agent.id }, db);
      startTask(failed.id, agent.id, db);
      failTask(failed.id, agent.id, "regression", undefined, db);
      db.run("UPDATE tasks SET retry_count = 2 WHERE id = ?", [failed.id]);
      addTaskVerification({
        task_id: failed.id,
        command: "bun test",
        status: "failed",
        output_summary: "red",
        agent_id: agent.id,
      }, db);
      const run = startTaskRun({ task_id: failed.id, agent_id: agent.id, title: "failed local run" }, db);
      addTaskRunCommand({ run_id: run.id, command: "bun test", status: "failed", agent_id: agent.id }, db);
      finishTaskRun({ run_id: run.id, status: "failed", summary: "tests failed", agent_id: agent.id }, db);

      const stale = createTask({ title: "Stale lock", project_id: project.id, agent_id: agent.id }, db);
      db.run("UPDATE tasks SET status = 'in_progress', locked_by = ?, locked_at = ? WHERE id = ?", [
        agent.id,
        "2020-01-01T00:00:00.000Z",
        stale.id,
      ]);
      db.run(
        "INSERT INTO resource_locks (resource_type, resource_id, agent_id, lock_type, locked_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
        ["file", "src/demo.ts", agent.id, "exclusive", "2020-01-01T00:00:00.000Z", "2020-01-01T01:00:00.000Z"],
      );
      createHandoff({
        agent_id: agent.id,
        project_id: project.id,
        summary: "Continue failed implementation",
        task_ids: [failed.id],
        blockers: ["verification failed"],
      }, db);

      const scorecard = getAgentReliabilityScorecard(agent.id, { project_id: project.id, stale_after_hours: 1 }, db)!;
      expect(scorecard.local_only).toBe(true);
      expect(scorecard.no_network).toBe(true);
      expect(scorecard.agent_name).toBe("metricbot");
      expect(scorecard.signals.tasks_completed).toBe(1);
      expect(scorecard.signals.tasks_failed).toBe(1);
      expect(scorecard.signals.tasks_in_progress).toBe(1);
      expect(scorecard.signals.failed_verifications).toBe(2);
      expect(scorecard.signals.runs_failed).toBe(1);
      expect(scorecard.signals.stale_task_locks).toBe(1);
      expect(scorecard.signals.stale_resource_locks).toBe(1);
      expect(scorecard.signals.handoffs_created).toBe(1);
      expect(scorecard.signals.handoffs_with_task_refs).toBe(1);
      expect(scorecard.signals.retry_count).toBe(2);
      expect(scorecard.score).toBeLessThan(100);
      expect(scorecard.recommendations.join(" ")).toContain("failed");

      const listed = listAgentReliabilityScorecards({ project_id: project.id }, db);
      expect(listed.map((entry) => entry.agent_id)).toContain(agent.id);

      const exported = createAgentReliabilityExport({ agent_id: agent.id, project_id: project.id }, db);
      expect(exported.count).toBe(1);
      expect(renderAgentReliabilityMarkdown(exported)).toContain("# Agent Reliability Scorecards");
    });

    it("returns null for unknown agents", () => {
      expect(getAgentReliabilityScorecard("unknown-agent", {}, db)).toBeNull();
    });
  });
});
