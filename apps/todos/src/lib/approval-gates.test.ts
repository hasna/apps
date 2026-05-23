import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTask, getTask, startTask } from "../db/tasks.js";
import { createProject } from "../db/projects.js";
import { createPlan } from "../db/plans.js";
import {
  requestApproval,
  approveGate,
  rejectGate,
  listPendingApprovals,
  getTaskGateStatus,
  createManualCheckpoint,
  enablePlanApprovalGates,
  assertTaskGate,
  approveTaskViaGate,
} from "./approval-gates.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("approval gates", () => {
  it("creates and approves completion gate", () => {
    const project = createProject({ name: "appr", path: "/tmp/appr" });
    const task = createTask({ title: "Needs sign-off", project_id: project.id, requires_approval: true });
    startTask(task.id, "agent-a");

    const req = requestApproval({ task_id: task.id, gate_type: "complete", requested_by: "agent-a", note: "Ready for review" });
    expect(req.status).toBe("pending");
    expect(listPendingApprovals({ task_id: task.id })).toHaveLength(1);

    approveGate(req.id, "reviewer", "LGTM");
    const updated = getTask(task.id)!;
    expect(updated.approved_by).toBe("reviewer");
  });

  it("blocks completion until approved", () => {
    const task = createTask({ title: "Blocked", requires_approval: true });
    startTask(task.id, "agent-a");
    requestApproval({ task_id: task.id, gate_type: "complete" });

    expect(() => assertTaskGate(task.id, "complete")).toThrow(/approval/i);
    const status = getTaskGateStatus(task.id);
    expect(status.ready_to_complete).toBe(false);
  });

  it("manual checkpoint requires approval", () => {
    const task = createTask({ title: "Checkpoint task" });
    const { approval_request } = createManualCheckpoint(task.id, "deploy", { requires_approval: true, requested_by: "agent-a" });
    expect(approval_request?.gate_type).toBe("checkpoint");

    rejectGate(approval_request!.id, "reviewer", "Not yet");
    expect(listPendingApprovals({ task_id: task.id })).toHaveLength(0);
  });

  it("plan approval gates apply to all plan tasks", () => {
    const project = createProject({ name: "plan-appr", path: "/tmp/plan" });
    const plan = createPlan({ name: "Release", project_id: project.id });
    createTask({ title: "Step 1", project_id: project.id, plan_id: plan.id });
    createTask({ title: "Step 2", project_id: project.id, plan_id: plan.id });

    const count = enablePlanApprovalGates(plan.id);
    expect(count).toBe(2);
    expect(listPendingApprovals({ plan_id: plan.id }).length).toBeGreaterThanOrEqual(2);
  });

  it("approveTaskViaGate clears pending complete requests", () => {
    const task = createTask({ title: "Bulk approve", requires_approval: true });
    requestApproval({ task_id: task.id, gate_type: "complete" });
    approveTaskViaGate(task.id, "lead");
    expect(getTask(task.id)?.approved_by).toBe("lead");
  });
});
