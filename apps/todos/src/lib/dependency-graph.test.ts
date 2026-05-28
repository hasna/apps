import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTask, addDependency, completeTask } from "../db/tasks.js";
import { createPlan } from "../db/plans.js";
import { createProject } from "../db/projects.js";
import {
  DEPENDENCY_GRAPH_SCHEMA,
  getReadyTasks,
  getBlockedTaskReports,
  getCriticalPath,
  getUnlockImpact,
  analyzeDependencyGraph,
  getBlockers,
} from "./dependency-graph.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("dependency graph", () => {
  it("lists ready unblocked pending tasks", () => {
    createTask({ title: "Ready A", priority: "high" });
    const blocker = createTask({ title: "Blocker" });
    const blocked = createTask({ title: "Blocked", priority: "critical" });
    addDependency(blocked.id, blocker.id);

    const ready = getReadyTasks();
    expect(ready.length).toBe(2);
    expect(ready[0]!.task.title).toBe("Ready A");
    expect(ready.every((r) => r.schema_version === DEPENDENCY_GRAPH_SCHEMA)).toBe(true);
  });

  it("reports blocked tasks with blockers", () => {
    const dep = createTask({ title: "Dependency", status: "pending" });
    const task = createTask({ title: "Blocked task" });
    addDependency(task.id, dep.id);

    const blocked = getBlockedTaskReports();
    expect(blocked).toHaveLength(1);
    expect(blocked[0]!.blockers[0]!.id).toBe(dep.id);
  });

  it("detects missing dependencies", () => {
    const db = getDatabase();
    const task = createTask({ title: "Orphan dep" });
    db.exec("PRAGMA foreign_keys = OFF");
    db.prepare("INSERT INTO task_dependencies (task_id, depends_on) VALUES (?, ?)").run(task.id, "missing-id-000");
    db.exec("PRAGMA foreign_keys = ON");

    const analysis = analyzeDependencyGraph();
    expect(analysis.missing_dependencies.some((m) => m.task_id === task.id)).toBe(true);
  });

  it("computes critical path by downstream count", () => {
    const root = createTask({ title: "Root blocker" });
    const mid = createTask({ title: "Middle" });
    const leaf = createTask({ title: "Leaf" });
    addDependency(mid.id, root.id);
    addDependency(leaf.id, mid.id);

    const path = getCriticalPath();
    expect(path[0]!.task.id).toBe(root.id);
    expect(path[0]!.downstream_count).toBeGreaterThan(0);
  });

  it("shows unlock impact when completing a blocker", () => {
    const blocker = createTask({ title: "Blocker" });
    const blocked = createTask({ title: "Waiting" });
    const alsoBlocked = createTask({ title: "Needs two" });
    const second = createTask({ title: "Second dep" });
    addDependency(blocked.id, blocker.id);
    addDependency(alsoBlocked.id, blocker.id);
    addDependency(alsoBlocked.id, second.id);

    const impact = getUnlockImpact(blocker.id);
    expect(impact.would_unlock.some((t) => t.id === blocked.id)).toBe(true);
    expect(impact.still_blocked_after.some((t) => t.id === alsoBlocked.id)).toBe(true);
  });

  it("filters by plan_id", () => {
    const project = createProject({ name: "dep-graph", path: "/tmp/dg" });
    const plan = createPlan({ name: "Sprint 1", project_id: project.id });
    createTask({ title: "In plan", plan_id: plan.id, project_id: project.id });
    createTask({ title: "No plan" });

    const ready = getReadyTasks({ plan_id: plan.id });
    expect(ready).toHaveLength(1);
    expect(ready[0]!.task.title).toBe("In plan");
  });

  it("returns null blockers for unblocked task", () => {
    const task = createTask({ title: "Free" });
    expect(getBlockers(task.id)).toBeNull();
  });

  it("clears blockers after dependency completes", () => {
    const dep = createTask({ title: "Dep" });
    const task = createTask({ title: "Waiting" });
    addDependency(task.id, dep.id);
    expect(getBlockedTaskReports()).toHaveLength(1);

    completeTask(dep.id);
    expect(getBlockedTaskReports()).toHaveLength(0);
    expect(getReadyTasks().some((r) => r.task.id === task.id)).toBe(true);
  });
});
