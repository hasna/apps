import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTask, addDependency, completeTask } from "../db/tasks.js";
import { createPlan } from "../db/plans.js";
import { createProject } from "../db/projects.js";
import type { Task } from "../types/index.js";
import {
  DEPENDENCY_GRAPH_SCHEMA,
  TASK_DEPENDENCY_EDGES_SCHEMA,
  PROJECT_DEPENDENCY_GRAPH_SCHEMA,
  getReadyTasks,
  getBlockedTaskReports,
  getCriticalPath,
  getUnlockImpact,
  analyzeDependencyGraph,
  getBlockers,
  getTaskDependencyEdges,
  getProjectDependencyGraph,
  buildProjectDependencyGraph,
  detectCyclesFromEdges,
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

describe("machine-readable dependency edges", () => {
  it("reads a task's direct edges with ids + status, both directions", () => {
    // A <- B <- C  (B depends on A, C depends on B)
    const a = createTask({ title: "A", status: "completed" });
    const b = createTask({ title: "B", priority: "high" });
    const c = createTask({ title: "C" });
    addDependency(b.id, a.id);
    addDependency(c.id, b.id);

    const edges = getTaskDependencyEdges(b.id);
    expect(edges).not.toBeNull();
    expect(edges!.schema_version).toBe(TASK_DEPENDENCY_EDGES_SCHEMA);
    expect(edges!.task_id).toBe(b.id);
    // Prerequisites of B (upstream): A only.
    expect(edges!.dependencies).toHaveLength(1);
    expect(edges!.dependencies[0]).toMatchObject({ id: a.id, title: "A", status: "completed" });
    // A is completed, so nothing blocks B right now.
    expect(edges!.blocked_by).toEqual([]);
    // Dependents of B (downstream): C only — under `blocks`, never `blocked_by`
    // (regression 4599ef37).
    expect(edges!.blocks).toHaveLength(1);
    expect(edges!.blocks[0]).toMatchObject({ id: c.id, title: "C", status: "pending" });
    // Compact node — carries id + status but not the full task row.
    expect(Object.keys(edges!.dependencies[0]!).sort()).toEqual(
      ["id", "plan_id", "priority", "project_id", "short_id", "status", "title"],
    );
  });

  it("returns empty edge arrays for a task with no dependencies", () => {
    const solo = createTask({ title: "Solo" });
    const edges = getTaskDependencyEdges(solo.id);
    expect(edges).toMatchObject({ task_id: solo.id, dependencies: [], blocked_by: [], blocks: [] });
  });

  it("returns null for a task that does not exist", () => {
    expect(getTaskDependencyEdges("00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("skips a dangling edge whose target task was removed", () => {
    const task = createTask({ title: "Has ghost dep" });
    const d = getDatabase();
    d.exec("PRAGMA foreign_keys = OFF");
    d.prepare("INSERT INTO task_dependencies (task_id, depends_on) VALUES (?, ?)").run(task.id, "ghost-id-000");
    d.exec("PRAGMA foreign_keys = ON");
    const edges = getTaskDependencyEdges(task.id);
    // The dangling edge is not resolvable to a node, so it is omitted rather
    // than crashing or emitting a null-filled entry.
    expect(edges!.dependencies).toEqual([]);
  });

  it("reads a whole-project graph: nodes scoped to the project, edges as adjacency", () => {
    const project = createProject({ name: "graph-proj", path: "/tmp/graph-proj" });
    const other = createProject({ name: "other-proj", path: "/tmp/other-proj" });
    const a = createTask({ title: "PA", project_id: project.id });
    const b = createTask({ title: "PB", project_id: project.id });
    const external = createTask({ title: "External", project_id: other.id });
    addDependency(b.id, a.id); // in-project edge
    addDependency(a.id, external.id); // cross-project prerequisite

    const graph = getProjectDependencyGraph({ project_id: project.id });
    expect(graph.schema_version).toBe(PROJECT_DEPENDENCY_GRAPH_SCHEMA);
    expect(graph.project_id).toBe(project.id);
    // Only the two in-project tasks are nodes.
    expect(graph.nodes.map((n) => n.id).sort()).toEqual([a.id, b.id].sort());
    // Both edges are retained because their dependent (task_id) is in-project,
    // even though one depends_on points at a task outside the project.
    const asPairs = graph.edges.map((e) => `${e.task_id}->${e.depends_on}`).sort();
    expect(asPairs).toEqual([`${a.id}->${external.id}`, `${b.id}->${a.id}`].sort());
    expect(graph.cycles).toEqual([]);
  });

  it("reports a cycle contained in the returned edges", () => {
    const project = createProject({ name: "cycle-proj", path: "/tmp/cycle-proj" });
    const x = createTask({ title: "X", project_id: project.id });
    const y = createTask({ title: "Y", project_id: project.id });
    // addDependency refuses a cycle, so write the back-edge directly.
    addDependency(y.id, x.id);
    const d = getDatabase();
    d.exec("PRAGMA foreign_keys = OFF");
    d.prepare("INSERT INTO task_dependencies (task_id, depends_on) VALUES (?, ?)").run(x.id, y.id);
    d.exec("PRAGMA foreign_keys = ON");

    const graph = getProjectDependencyGraph({ project_id: project.id });
    expect(graph.cycles.length).toBeGreaterThan(0);
  });

  it("buildProjectDependencyGraph is pure: drops edges outside the node set", () => {
    const graph = buildProjectDependencyGraph(
      "p1",
      [
        { id: "t1", short_id: null, title: "t1", status: "pending", priority: "medium", plan_id: null, project_id: "p1" },
        { id: "t2", short_id: null, title: "t2", status: "pending", priority: "medium", plan_id: null, project_id: "p1" },
      ] as unknown as Task[],
      [
        { task_id: "t1", depends_on: "t2" },
        { task_id: "outsider", depends_on: "t1" }, // dependent not in nodes -> dropped
      ],
    );
    expect(graph.edges).toEqual([{ task_id: "t1", depends_on: "t2" }]);
    expect(graph.nodes).toHaveLength(2);
  });

  it("detectCyclesFromEdges finds a two-node cycle and ignores acyclic edges", () => {
    expect(detectCyclesFromEdges([{ task_id: "a", depends_on: "b" }, { task_id: "b", depends_on: "a" }]).length)
      .toBeGreaterThan(0);
    expect(detectCyclesFromEdges([{ task_id: "a", depends_on: "b" }, { task_id: "b", depends_on: "c" }]))
      .toEqual([]);
  });
});
