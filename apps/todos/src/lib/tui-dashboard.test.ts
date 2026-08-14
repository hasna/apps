import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createInboxItem } from "../db/inbox.js";
import { createPlan } from "../db/plans.js";
import { createProject } from "../db/projects.js";
import { startTaskRun } from "../db/task-runs.js";
import { addDependency, createTask } from "../db/tasks.js";
import { createTuiDashboardSnapshot, renderTuiDashboardSnapshot } from "./tui-dashboard.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("terminal TUI dashboard snapshot", () => {
  test("summarizes projects tasks plans runs dependencies inbox and search from local state", () => {
    const db = getDatabase();
    const project = createProject({ name: "TUI Project", path: "/tmp/tui-project" }, db);
    const plan = createPlan({ name: "TUI Plan", project_id: project.id }, db);
    const dependency = createTask({ title: "Prepare terminal data", project_id: project.id, status: "pending" }, db);
    const task = createTask({ title: "Build terminal dashboard", project_id: project.id, plan_id: plan.id, priority: "high" }, db);
    addDependency(task.id, dependency.id, db);
    startTaskRun({ task_id: task.id, agent_id: "codex", title: "TUI smoke run" }, db);
    createInboxItem({
      body: "bun test failed while rendering dashboard",
      project_id: project.id,
      create_task: false,
    }, db);

    const snapshot = createTuiDashboardSnapshot({
      project_id: project.id,
      active_view: "search",
      search: "dashboard",
      limit: 5,
    }, db);

    expect(snapshot.local_only).toBe(true);
    expect(snapshot.counts.pending).toBeGreaterThanOrEqual(2);
    expect(snapshot.projects[0]?.name).toBe("TUI Project");
    expect(snapshot.plans[0]?.name).toBe("TUI Plan");
    expect(snapshot.plans[0]?.open_tasks).toBe(1);
    expect(snapshot.tasks.map(item => item.title)).toContain("Build terminal dashboard");
    expect(snapshot.runs[0]?.title).toBe("TUI smoke run");
    expect(snapshot.dependencies[0]).toMatchObject({
      task_id: task.id,
      depends_on: dependency.id,
      blocking: true,
    });
    expect(snapshot.inbox[0]?.title.toLowerCase()).toContain("failure");
    expect(snapshot.search.results.map(item => item.id)).toContain(task.id);

    const markdown = renderTuiDashboardSnapshot(snapshot);
    expect(markdown).toContain("# todos terminal dashboard");
    expect(markdown).toContain("Keys: q quit");
    expect(markdown).toContain("## Dependencies");
    expect(markdown).toContain("## Inbox");
    expect(markdown).toContain("Query: dashboard");
  });
});
