import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createPlan } from "../db/plans.js";
import { addTaskFile } from "../db/task-files.js";
import { createTask, startTask } from "../db/tasks.js";
import { createBranchWorkPlan } from "./branch-work-plans.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("local branch-safe work plans", () => {
  test("builds a safe local branch plan from task files without network access", () => {
    const db = getDatabase();
    const task = createTask({ title: "Parser branch plan" }, db);
    addTaskFile({ task_id: task.id, path: "src/parser.ts", status: "planned", agent_id: "codex" }, db);

    const plan = createBranchWorkPlan({
      task_id: task.id,
      branch: "task/parser-branch-plan",
      base_branch: "main",
      root: "/tmp/not-a-git-repo",
      include_git_status: false,
    }, db);

    expect(plan.local_only).toBe(true);
    expect(plan.safe_to_start).toBe(true);
    expect(plan.files).toEqual(["src/parser.ts"]);
    expect(plan.commands).toEqual(expect.arrayContaining([
      `git switch -c task/parser-branch-plan main`,
      `todos link-ref ${task.id.slice(0, 8)} task/parser-branch-plan --type branch --provider git`,
    ]));
  });

  test("reports active file conflicts for plan-scoped branch work", () => {
    const db = getDatabase();
    const releasePlan = createPlan({ name: "Release branch plan" }, db);
    const target = createTask({ title: "Update release notes", plan_id: releasePlan.id }, db);
    const conflicting = createTask({ title: "Rewrite release notes", status: "pending" }, db);
    addTaskFile({ task_id: target.id, path: "docs/release.md", status: "planned", agent_id: "codex" }, db);
    addTaskFile({ task_id: conflicting.id, path: "docs/release.md", status: "active", agent_id: "claude" }, db);
    startTask(conflicting.id, "claude", db);

    const workPlan = createBranchWorkPlan({
      plan_id: releasePlan.id,
      branch: "task/release-notes",
      root: "/tmp/not-a-git-repo",
      include_git_status: false,
    }, db);

    expect(workPlan.safe_to_start).toBe(false);
    expect(workPlan.conflicts).toHaveLength(1);
    expect(workPlan.conflicts[0]).toMatchObject({
      path: "docs/release.md",
      conflicting_task_id: conflicting.id,
      conflicting_task_status: "in_progress",
      level: "hard",
    });
    expect(workPlan.reasons).toContain("active file conflicts must be resolved before starting");
  });
});
