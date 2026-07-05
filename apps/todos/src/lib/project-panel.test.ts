import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ProjectPanelSchema, SCHEMA_IDS } from "@hasna/contracts";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createPlan } from "../db/plans.js";
import { createProject } from "../db/projects.js";
import { addDependency, createTask } from "../db/tasks.js";
import { createTodosProjectPanel } from "./project-panel.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("createTodosProjectPanel", () => {
  it("emits a contract-valid project panel with task counts and blockers", () => {
    const db = getDatabase();
    const project = createProject({ name: "Swiss Bank Account", path: "/tmp/swiss-bank-account", task_list_id: "todos-swiss-bank-account" }, db);
    const plan = createPlan({ name: "Document Review", project_id: project.id }, db);
    const blocker = createTask({ title: "Collect passport scan", project_id: project.id, priority: "high", plan_id: plan.id }, db);
    const blocked = createTask({ title: "Read potential contract", project_id: project.id, priority: "critical", plan_id: plan.id }, db);
    addDependency(blocked.id, blocker.id, db);

    const panel = createTodosProjectPanel(project.id, { db, limit: 10 });
    const parsed = ProjectPanelSchema.safeParse(panel);

    expect(parsed.success).toBe(true);
    expect(panel.schema).toBe(SCHEMA_IDS.projectPanel);
    expect(panel.projectId).toBe("swiss-bank-account");
    expect(panel.provider.kind).toBe("todos");
    expect(panel.metrics.find((metric) => metric.id === "blocked_tasks")?.value).toBe(1);
    expect(panel.metrics.find((metric) => metric.id === "active_plans")?.value).toBe(1);
    expect(panel.items.some((item) => item.id === blocked.id && item.summary?.includes(blocker.id.slice(0, 8)))).toBe(true);
  });

  it("uses empty state for projects without tasks or plans", () => {
    const db = getDatabase();
    const project = createProject({ name: "Empty Project", path: "/tmp/empty-project", task_list_id: "todos-empty-project" }, db);

    const panel = createTodosProjectPanel(project.id, { db });

    expect(panel.state).toBe("empty");
    expect(panel.projectId).toBe("empty-project");
    expect(panel.metrics.find((metric) => metric.id === "total_tasks")?.value).toBe(0);
  });
});
