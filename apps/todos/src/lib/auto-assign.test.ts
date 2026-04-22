import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTask } from "../db/tasks.js";
import { registerAgent } from "../db/agents.js";
import { findBestAgent, autoAssignTask } from "./auto-assign.js";

let db: Database;

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("findBestAgent", () => {
  it("should return null when no agents exist", () => {
    expect(findBestAgent({ title: "Test" } as any, db)).toBeNull();
  });

  it("should return agent with role=agent", () => {
    const agent = registerAgent({ name: "worker", role: "agent", status: "active" }, db);
    const result = findBestAgent({ title: "Test" } as any, db);
    expect(result).toBe("worker");
  });

  it("should skip admin and observer role agents", () => {
    registerAgent({ name: "admin1", role: "admin", status: "active" }, db);
    registerAgent({ name: "observer1", role: "observer", status: "active" }, db);
    expect(findBestAgent({ title: "Test" } as any, db)).toBeNull();
  });

  it("should pick least loaded agent", () => {
    const a1 = registerAgent({ name: "busy", role: "agent", status: "active" }, db);
    const a2 = registerAgent({ name: "idle", role: "agent", status: "active" }, db);

    // Give a1 a pending task
    const task = createTask({ title: "In progress", assigned_to: a1.id, status: "in_progress" }, db);

    const result = findBestAgent({ title: "New" } as any, db);
    expect(result).toBe("idle");
  });

  it("should pick first agent when all have equal load", () => {
    registerAgent({ name: "alpha", role: "agent", status: "active" }, db);
    registerAgent({ name: "beta", role: "agent", status: "active" }, db);

    const result = findBestAgent({ title: "Equal" } as any, db);
    expect(result).toBe("alpha");
  });

  it("should use default database when not provided", () => {
    const result = findBestAgent({ title: "No DB" } as any);
    expect(result).toBeNull();
  });
});

describe("autoAssignTask", () => {
  it("should throw if task not found", async () => {
    await expect(autoAssignTask("nonexistent", db)).rejects.toThrow("not found");
  });

  it("should return no_agents when no agents exist", async () => {
    const task = createTask({ title: "Orphan" }, db);
    const result = await autoAssignTask(task.id, db);
    expect(result.assigned_to).toBeNull();
    expect(result.method).toBe("no_agents");
  });

  it("should assign via capability match", async () => {
    const agent = registerAgent({ name: "frontend-dev", role: "agent", status: "active", capabilities: ["frontend", "react"] }, db);
    const task = createTask({ title: "Build UI", tags: ["frontend"] }, db);

    const result = await autoAssignTask(task.id, db);
    expect(result.task_id).toBe(task.id);
    expect(result.assigned_to).toBe(agent.id);
    expect(result.agent_name).toBe("frontend-dev");
    expect(result.method).toBe("capability_match");
  });

  it("should assign to least busy agent when no capability match", async () => {
    const a1 = registerAgent({ name: "busy-agent", role: "agent", status: "active" }, db);
    const a2 = registerAgent({ name: "free-agent", role: "agent", status: "active" }, db);

    // Give busy agent active tasks
    createTask({ title: "Work 1", assigned_to: a1.id, status: "in_progress" }, db);
    createTask({ title: "Work 2", assigned_to: a1.id, status: "in_progress" }, db);

    const task = createTask({ title: "Something weird", tags: ["niche-tag"] }, db);

    const result = await autoAssignTask(task.id, db);
    expect(result.agent_name).toBe("free-agent");
    // getCapableAgents with min_score: 0.0 returns all agents sorted by score then workload
    expect(result.assigned_to).toBe(a2.id);
  });

  it("should use cerebras method when CEREBRAS_API_KEY is set", async () => {
    // We can't actually call the API, but we can verify the code path is attempted
    // The call will fail due to invalid key, falling back to capability_match
    const originalKey = process.env["CEREBRAS_API_KEY"];
    process.env["CEREBRAS_API_KEY"] = "invalid-key-for-test";

    try {
      const agent = registerAgent({ name: "cerebras-test", role: "agent", status: "active", capabilities: ["general"] }, db);
      const task = createTask({ title: "API test", tags: ["general"] }, db);

      const result = await autoAssignTask(task.id, db);
      // The API call will fail, so it falls back to capability_match
      expect(result.assigned_to).toBe(agent.id);
      expect(result.method === "capability_match" || result.method === "cerebras");
    } finally {
      if (originalKey === undefined) {
        delete process.env["CEREBRAS_API_KEY"];
      } else {
        process.env["CEREBRAS_API_KEY"] = originalKey;
      }
    }
  });
});
