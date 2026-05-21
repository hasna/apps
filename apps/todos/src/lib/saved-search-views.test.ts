import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { addComment } from "../db/comments.js";
import { addDependency, createTask } from "../db/tasks.js";
import { createProject } from "../db/projects.js";
import { createPlan } from "../db/plans.js";
import { startTaskRun } from "../db/task-runs.js";
import { setTaskLocalFields } from "./local-fields.js";
import {
  deleteSearchView,
  listSearchViews,
  runSavedSearch,
  runSearchView,
  saveSearchView,
} from "./saved-search-views.js";

let db: ReturnType<typeof getDatabase>;

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("saved search views", () => {
  test("saves, lists, runs, updates, and deletes task views", () => {
    const project = createProject({ name: "Search Project", path: "/tmp/search-project" }, db);
    const task = createTask({
      title: "Ship local saved views",
      project_id: project.id,
      priority: "high",
      tags: ["search", "local"],
    }, db);
    createTask({ title: "Unrelated work", project_id: project.id, tags: ["other"] }, db);
    setTaskLocalFields(task.id, { labels: ["frontend"], area: "cli" }, db);

    const view = saveSearchView({
      name: "local-cli-search",
      scope: "tasks",
      filters: {
        query: "saved",
        project_id: project.id,
        tags: ["search"],
        local_fields: { labels: ["frontend"], area: "cli" },
      },
    }, db);

    expect(listSearchViews("tasks", db).map((row) => row.name)).toEqual(["local-cli-search"]);
    const result = runSearchView(view.name, db);
    expect(result.count).toBe(1);
    expect(result.results[0]!.entity_type).toBe("tasks");
    expect((result.results[0]!.entity as typeof task).id).toBe(task.id);

    const updated = saveSearchView({
      name: "local-cli-search",
      scope: "tasks",
      filters: { query: "Unrelated", project_id: project.id },
    }, db);
    expect(updated.id).toBe(view.id);
    expect(runSearchView(view.id, db).count).toBe(1);

    expect(deleteSearchView(view.name, db)).toBe(true);
    expect(listSearchViews(undefined, db)).toEqual([]);
  });

  test("searches projects, plans, runs, and comments with stable result envelopes", () => {
    const project = createProject({ name: "Planner Project", path: "/tmp/planner-project" }, db);
    const plan = createPlan({ name: "Launch plan", project_id: project.id, status: "active" }, db);
    const task = createTask({ title: "Launch task", project_id: project.id, plan_id: plan.id }, db);
    const run = startTaskRun({ task_id: task.id, agent_id: "codex", title: "Agent launch run" }, db);
    const comment = addComment({ task_id: task.id, content: "Launch note from agent", agent_id: "codex" }, db);

    const result = runSavedSearch({ project_id: project.id, limit: 20 }, "all", db);

    expect(result.scope).toBe("all");
    expect(result.results.some((item) => item.entity_type === "projects" && item.entity.id === project.id)).toBe(true);
    expect(result.results.some((item) => item.entity_type === "plans" && item.entity.id === plan.id)).toBe(true);
    expect(result.results.some((item) => item.entity_type === "runs" && item.entity.id === run.id)).toBe(true);
    expect(result.results.some((item) => item.entity_type === "comments" && item.entity.id === comment.id)).toBe(true);
    expect(result.count).toBe(result.results.length);
  });

  test("filters tasks by dependency direction", () => {
    const dependency = createTask({ title: "Prepare dependency" }, db);
    const blocked = createTask({ title: "Blocked by dependency" }, db);
    const unrelated = createTask({ title: "Unrelated dependency task" }, db);
    addDependency(blocked.id, dependency.id, db);

    const dependsOn = runSavedSearch({ depends_on: dependency.id }, "tasks", db);
    expect(dependsOn.results.map((item) => item.entity.id)).toEqual([blocked.id]);

    const blocks = runSavedSearch({ blocks: blocked.id }, "tasks", db);
    expect(blocks.results.map((item) => item.entity.id)).toEqual([dependency.id]);
    expect(blocks.results.map((item) => item.entity.id)).not.toContain(unrelated.id);
  });
});
