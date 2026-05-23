import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createProject } from "../db/projects.js";
import { createPlan } from "../db/plans.js";
import { completeTask } from "../db/tasks.js";
import {
  PLAN_EXECUTION_SCHEMA,
  attachPlanToProject,
  materializePlanSteps,
  getPlanExecutionState,
  claimPlanStep,
  createPlanWithSteps,
  exportPlanExecutionContract,
} from "./plan-execution.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("plan execution", () => {
  it("attaches plan to project and materializes sequential steps", () => {
    const project = createProject({ name: "exec-proj", path: "/tmp/exec" });
    const plan = createPlan({ name: "Release plan", project_id: project.id });

    attachPlanToProject({ plan_id: plan.id, project_id: project.id, execution_mode: "sequential" });
    const manifest = materializePlanSteps({
      plan_id: plan.id,
      steps: [{ title: "Step 1" }, { title: "Step 2" }, { title: "Step 3" }],
    });

    expect(manifest.schema_version).toBe(PLAN_EXECUTION_SCHEMA);
    expect(manifest.step_task_ids).toHaveLength(3);
    expect(manifest.execution_mode).toBe("sequential");
  });

  it("tracks plan execution progress", () => {
    const project = createProject({ name: "prog", path: "/tmp/prog" });
    const manifest = createPlanWithSteps("Sprint", [{ title: "A" }, { title: "B" }], {
      project_id: project.id,
      execution_mode: "sequential",
    });

    const state = getPlanExecutionState(manifest.plan_id)!;
    expect(state.total_steps).toBe(2);
    expect(state.pending).toBe(2);
    expect(state.percent_complete).toBe(0);
  });

  it("claims next ready plan step", () => {
    const project = createProject({ name: "claim", path: "/tmp/claim" });
    const manifest = createPlanWithSteps("Claim plan", [{ title: "First" }, { title: "Second" }], {
      project_id: project.id,
    });

    const claimed = claimPlanStep(manifest.plan_id, "agent-a");
    expect(claimed).not.toBeNull();
    expect(claimed!.status).toBe("in_progress");
    expect(claimed!.tags).toContain("plan-step");
  });

  it("exports portable execution contract", () => {
    const project = createProject({ name: "export", path: "/tmp/export" });
    const manifest = createPlanWithSteps("Export plan", [{ title: "Only" }], { project_id: project.id });
    const contract = exportPlanExecutionContract(manifest.plan_id);
    expect(contract?.schema_version).toBe(PLAN_EXECUTION_SCHEMA);
    expect(contract?.portable).toBe(true);
  });

  it("updates percent complete after step completion", () => {
    const project = createProject({ name: "done", path: "/tmp/done" });
    const manifest = createPlanWithSteps("Done plan", [{ title: "One" }, { title: "Two" }], {
      project_id: project.id,
    });
    const claimed = claimPlanStep(manifest.plan_id, "agent-a")!;
    completeTask(claimed.id);

    const state = getPlanExecutionState(manifest.plan_id)!;
    expect(state.completed).toBe(1);
    expect(state.percent_complete).toBe(50);
  });
});
