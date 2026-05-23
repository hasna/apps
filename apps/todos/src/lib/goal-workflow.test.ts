import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createProject } from "../db/projects.js";
import {
  parseGoalCommand,
  createGoalWorkflow,
  getGoalProgress,
  claimGoalStep,
  formatGoalHandoff,
  resolvePlanId,
  getGoalCommandRecipesMarkdown,
  GOAL_COMMAND_RECIPES,
} from "./goal-workflow.js";

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

describe("parseGoalCommand", () => {
  it("parses /goal execute commands", () => {
    expect(parseGoalCommand("/goal execute website-launch")).toEqual({
      action: "execute",
      target: "website-launch",
      raw: "/goal execute website-launch",
    });
  });

  it("parses bare action commands", () => {
    expect(parseGoalCommand("status my-plan").action).toBe("status");
  });
});

describe("createGoalWorkflow", () => {
  it("creates plan, root task, and sequential steps", () => {
    const project = createProject({ name: "Goal Project", path: "/tmp/goal-test" }, db);
    const manifest = createGoalWorkflow({
      goal: "Launch website",
      project_id: project.id,
      steps: [
        { title: "Design pages" },
        { title: "Implement API" },
        { title: "Deploy" },
      ],
    }, db);

    expect(manifest.schema_version).toBe("todos.goal-workflow.v1");
    expect(manifest.step_task_ids).toHaveLength(3);
    expect(resolvePlanId(manifest.plan_name, db)).toBe(manifest.plan_id);

    const progress = getGoalProgress(manifest.plan_id, db)!;
    expect(progress.total_steps).toBe(3);
    expect(progress.pending).toBe(3);
  });

  it("defaults to single step from goal text", () => {
    const manifest = createGoalWorkflow({ goal: "Fix auth bug" }, db);
    expect(manifest.step_task_ids).toHaveLength(1);
  });
});

describe("claimGoalStep", () => {
  it("claims next pending step for agent", () => {
    const manifest = createGoalWorkflow({
      goal: "Build feature",
      steps: [{ title: "Step A" }, { title: "Step B" }],
    }, db);

    const claimed = claimGoalStep(manifest.plan_name, "goal-agent", db);
    expect(claimed).not.toBeNull();
    expect(claimed!.status).toBe("in_progress");

    const progress = getGoalProgress(manifest.plan_id, db)!;
    expect(progress.in_progress).toBe(1);
    expect(progress.pending).toBe(1);
  });
});

describe("formatGoalHandoff", () => {
  it("produces JSON and Markdown handoffs", () => {
    const manifest = createGoalWorkflow({
      goal: "Docs update",
      steps: [{ title: "Write docs" }],
    }, db);

    const json = formatGoalHandoff(manifest.plan_id, "json", "agent-1", db);
    expect(json).toBeTruthy();
    expect(json!).toContain("todos.goal-workflow.v1");

    const md = formatGoalHandoff(manifest.plan_id, "markdown", "agent-1", db);
    expect(md).toContain("# Goal Handoff");
    expect(md).toContain("Docs update");
  });
});

describe("local-only recipes", () => {
  it("exposes command recipes without hosted URLs", () => {
    expect(GOAL_COMMAND_RECIPES.length).toBeGreaterThan(0);
    const md = getGoalCommandRecipesMarkdown();
    expect(md).toContain("/goal execute");
    expect(md).not.toMatch(/todos\.md|platform-todos/i);
  });
});
