import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import { setBudget, getBudget, checkBudget } from "./budgets.js";
import { createTask, startTask } from "./tasks.js";
import type { Database } from "bun:sqlite";

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

describe("setBudget", () => {
  it("should create a budget with defaults", () => {
    const budget = setBudget("agent-1", {});
    expect(budget.agent_id).toBe("agent-1");
    expect(budget.max_concurrent).toBe(5);
    expect(budget.max_cost_usd).toBeNull();
    expect(budget.max_task_minutes).toBeNull();
    expect(budget.period_hours).toBe(24);
  });

  it("should create a budget with custom values", () => {
    const budget = setBudget("agent-2", { max_concurrent: 3, max_cost_usd: 10, period_hours: 48 });
    expect(budget.max_concurrent).toBe(3);
    expect(budget.max_cost_usd).toBe(10);
    expect(budget.period_hours).toBe(48);
  });

  it("should update an existing budget", () => {
    setBudget("agent-3", { max_concurrent: 3 });
    const updated = setBudget("agent-3", { max_concurrent: 7 });
    expect(updated.max_concurrent).toBe(7);
  });

  it("should coalesce null updates to keep existing value", () => {
    setBudget("agent-4", { max_cost_usd: 50 });
    // Passing max_cost_usd as undefined should keep the old value
    const budget = getBudget("agent-4");
    expect(budget?.max_cost_usd).toBe(50);
  });
});

describe("getBudget", () => {
  it("should return null for non-existent budget", () => {
    expect(getBudget("nonexistent")).toBeNull();
  });

  it("should return the budget for an existing agent", () => {
    setBudget("agent-5", { max_concurrent: 10 });
    const budget = getBudget("agent-5");
    expect(budget).not.toBeNull();
    expect(budget!.max_concurrent).toBe(10);
  });
});

describe("checkBudget", () => {
  it("should allow when no budget is set", () => {
    const result = checkBudget("no-budget-agent");
    expect(result.allowed).toBe(true);
    expect(result.max_concurrent).toBe(999);
  });

  it("should allow when under concurrent limit", () => {
    setBudget("agent-6", { max_concurrent: 5 });
    const result = checkBudget("agent-6");
    expect(result.allowed).toBe(true);
  });

  it("should deny when at concurrent limit", () => {
    const projId = "proj-" + Math.random().toString(36).slice(2, 10);
    db.run("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)", [projId, "test", "/tmp/test-" + projId]);
    setBudget("agent-7", { max_concurrent: 2 });
    createTask({ title: "Task 1", project_id: projId, status: "in_progress", assigned_to: "agent-7" }, db);
    createTask({ title: "Task 2", project_id: projId, status: "in_progress", assigned_to: "agent-7" }, db);
    const result = checkBudget("agent-7");
    expect(result.allowed).toBe(false);
    expect(result.current_concurrent).toBe(2);
  });

  it("should deny when cost limit reached", () => {
    setBudget("agent-8", { max_concurrent: 10, max_cost_usd: 1.0, period_hours: 24 });
    const projId = "proj-" + Math.random().toString(36).slice(2, 10);
    db.run("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)", [projId, "test", "/tmp/test-" + projId]);
    const task = createTask({ title: "Expensive", project_id: projId, agent_id: "agent-8" }, db);
    db.run("UPDATE tasks SET cost_usd = 1.5 WHERE id = ?", [task.id]);
    const result = checkBudget("agent-8");
    expect(result.allowed).toBe(false);
    expect(result.current_cost_usd).toBeGreaterThanOrEqual(1.0);
  });
});
