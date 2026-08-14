import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { addComment, listComments } from "../db/comments.js";
import { createPlan, listPlans } from "../db/plans.js";
import { createProject, listProjects } from "../db/projects.js";
import { createTask, getTask, getTaskDependencies, listTasks } from "../db/tasks.js";
import { startTaskRun } from "../db/task-runs.js";
import { exportTodosMarkdown, importTodosMarkdown } from "./todos-md.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("todos.md import/export", () => {
  test("exports readable markdown with an embedded bridge bundle for lossless import", () => {
    const sourceDb = getDatabase();
    const project = createProject({ name: "Markdown Project", path: "/tmp/markdown-project" }, sourceDb);
    const plan = createPlan({ name: "Launch Plan", project_id: project.id }, sourceDb);
    const task = createTask({
      title: "Ship markdown round trip",
      description: "Keep readable todos.md files portable.",
      priority: "high",
      project_id: project.id,
      plan_id: plan.id,
      tags: ["markdown", "migration"],
    }, sourceDb);
    addComment({ task_id: task.id, content: "Regression coverage added.", agent_id: "codex" }, sourceDb);
    startTaskRun({ task_id: task.id, agent_id: "codex", title: "markdown migration" }, sourceDb);

    const markdown = exportTodosMarkdown({ project_id: project.id, generatedAt: "2026-01-02T03:04:05.000Z" }, sourceDb);

    expect(markdown).toContain("---");
    expect(markdown).toContain("schema: hasna.todos.md/v1");
    expect(markdown).toContain("# todos.md");
    expect(markdown).toContain("## Project: Markdown Project");
    expect(markdown).toContain("### Plan: Launch Plan");
    expect(markdown).toContain("- [ ] Ship markdown round trip");
    expect(markdown).toContain("<!-- hasna.todos.bridge");

    closeDatabase();
    process.env["TODOS_DB_PATH"] = ":memory:";
    resetDatabase();
    const targetDb = getDatabase();
    const preview = importTodosMarkdown(markdown, { dryRun: true }, targetDb);
    expect(preview.mode).toBe("embedded_bridge");
    expect(preview.inserted.tasks).toBe(1);
    expect(listTasks({}, targetDb)).toHaveLength(0);

    const applied = importTodosMarkdown(markdown, { dryRun: false }, targetDb);
    expect(applied.ok).toBe(true);
    expect(getTask(task.id, targetDb)?.title).toBe("Ship markdown round trip");
    expect(listComments(task.id, targetDb)[0]?.content).toBe("Regression coverage added.");
  });

  test("imports existing plain todos.md checklists with projects, plans, comments, and dependencies", () => {
    const markdown = `---
project: Existing Markdown Project
---
# Project: Existing Markdown Project

## Plan: Migration

- [ ] Prepare importer #migration @codex
  priority: high
  Acceptance criteria copied from old todos.md.
  comment: Needs local-only migration.
- [x] Verify importer
  depends_on: Prepare importer
  run: completed local smoke
`;

    const result = importTodosMarkdown(markdown, { dryRun: false }, getDatabase());

    expect(result.mode).toBe("plain_markdown");
    expect(result.inserted.projects).toBe(1);
    expect(result.inserted.plans).toBe(1);
    expect(result.inserted.tasks).toBe(2);
    expect(result.inserted.comments).toBe(1);
    expect(result.inserted.runs).toBe(1);
    expect(result.inserted.task_dependencies).toBe(1);

    const project = listProjects()[0]!;
    expect(project.name).toBe("Existing Markdown Project");
    const plan = listPlans(project.id)[0]!;
    expect(plan.name).toBe("Migration");

    const tasks = listTasks({ project_id: project.id });
    expect(tasks.map((task) => task.title)).toEqual(["Prepare importer", "Verify importer"]);
    expect(tasks[0]!.priority).toBe("high");
    expect(tasks[0]!.assigned_to).toBe("codex");
    expect(tasks[0]!.tags).toContain("migration");
    expect(tasks[0]!.description).toContain("Acceptance criteria copied");
    expect(tasks[1]!.status).toBe("completed");
    expect(getTaskDependencies(tasks[1]!.id)).toEqual([{ task_id: tasks[1]!.id, depends_on: tasks[0]!.id, external_project_id: null, external_task_id: null }]);
    expect(listComments(tasks[0]!.id)[0]?.content).toBe("Needs local-only migration.");
  });
});
