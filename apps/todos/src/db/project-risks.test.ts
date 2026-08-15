import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Database } from "bun:sqlite";
import { closeDatabase, getDatabase, resetDatabase } from "./database.js";
import { createPlan } from "./plans.js";
import { createProject } from "./projects.js";
import { addTaskVerification } from "./task-commits.js";
import { addDependency } from "./task-graph.js";
import { startTaskRun, finishTaskRun } from "./task-runs.js";
import { createTask } from "./tasks.js";
import {
  closeRisk,
  createRisk,
  createRiskRegisterExport,
  listRisks,
  renderRiskRegisterMarkdown,
  scorePlanHealth,
  scoreProjectHealth,
  updateRisk,
} from "./project-risks.js";

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

describe("project risk register and health scoring", () => {
  it("stores local project and plan risks with owners, mitigations, and due dates", () => {
    const project = createProject({ name: "Risk Register", path: "/tmp/risk-register" }, db);
    const plan = createPlan({ name: "Risky release", project_id: project.id }, db);
    const task = createTask({ title: "Mitigate rollout issue", project_id: project.id, plan_id: plan.id }, db);

    const risk = createRisk({
      title: "External dependency may block release",
      description: "The package cannot ship until the dependency is ready.",
      severity: "high",
      probability: "medium",
      owner: "release-agent",
      mitigation: "Prepare a fallback implementation.",
      due_at: "2026-01-02T00:00:00.000Z",
      project_id: project.id.slice(0, 8),
      plan_id: plan.id.slice(0, 8),
      task_id: task.id.slice(0, 8),
      tags: ["release", "dependency"],
    }, db);

    expect(risk.project_id).toBe(project.id);
    expect(risk.plan_id).toBe(plan.id);
    expect(risk.task_id).toBe(task.id);
    expect(risk.status).toBe("open");
    expect(risk.owner).toBe("release-agent");

    const updated = updateRisk(risk.id.slice(0, 8), { status: "mitigating", severity: "critical" }, db);
    expect(updated.status).toBe("mitigating");
    expect(updated.severity).toBe("critical");

    const listed = listRisks({ plan_id: plan.id, severity: "critical", tag: "release" }, db);
    expect(listed.map((item) => item.id)).toEqual([risk.id]);

    const closed = closeRisk(risk.id, "accepted", db);
    expect(closed.status).toBe("accepted");
    expect(closed.closed_at).toBeTruthy();
    expect(listRisks({ plan_id: plan.id }, db)).toHaveLength(0);
    expect(listRisks({ plan_id: plan.id, include_closed: true }, db)).toHaveLength(1);
  });

  it("scores plan and project health from blockers, overdue work, failed evidence, dependency depth, and open risks", () => {
    const project = createProject({ name: "Health", path: "/tmp/health" }, db);
    const plan = createPlan({ name: "Health plan", project_id: project.id }, db);
    const root = createTask({ title: "Root blocker", project_id: project.id, plan_id: plan.id }, db);
    const middle = createTask({ title: "Middle dependency", project_id: project.id, plan_id: plan.id }, db);
    const blocked = createTask({
      title: "Blocked feature",
      project_id: project.id,
      plan_id: plan.id,
      due_at: "2020-01-01T00:00:00.000Z",
    }, db);
    addDependency(middle.id, root.id, db);
    addDependency(blocked.id, middle.id, db);
    addTaskVerification({
      task_id: blocked.id,
      command: "bun test",
      status: "failed",
      output_summary: "regression failed",
      agent_id: "codex",
    }, db);
    const run = startTaskRun({ task_id: blocked.id, title: "agent run", agent_id: "codex" }, db);
    finishTaskRun({ run_id: run.id, status: "failed", summary: "runner failed" }, db);
    createRisk({
      title: "Critical release risk",
      severity: "critical",
      probability: "high",
      owner: "owner",
      mitigation: "Fix before release",
      due_at: "2020-01-01T00:00:00.000Z",
      project_id: project.id,
      plan_id: plan.id,
    }, db);

    const planHealth = scorePlanHealth(plan.id.slice(0, 8), db);
    expect(planHealth.local_only).toBe(true);
    expect(planHealth.no_network).toBe(true);
    expect(planHealth.scope).toBe("plan");
    expect(planHealth.components.total_tasks).toBe(3);
    expect(planHealth.components.blocked_tasks).toBe(2);
    expect(planHealth.components.overdue_tasks).toBe(1);
    expect(planHealth.components.failed_checks).toBe(1);
    expect(planHealth.components.failed_runs).toBe(1);
    expect(planHealth.components.dependency_depth).toBe(2);
    expect(planHealth.components.open_risks).toBe(1);
    expect(planHealth.components.critical_risks).toBe(1);
    expect(planHealth.score).toBeLessThan(100);
    expect(planHealth.recommendations.join(" ")).toContain("blocking dependencies");

    const projectHealth = scoreProjectHealth(project.id, db);
    expect(projectHealth.scope).toBe("project");
    expect(projectHealth.components.total_tasks).toBe(3);

    const exported = createRiskRegisterExport({ project_id: project.id }, db);
    expect(exported.local_only).toBe(true);
    expect(exported.no_network).toBe(true);
    expect(exported.risks).toHaveLength(1);
    expect(renderRiskRegisterMarkdown(exported)).toContain("# Risk Register");
  });
});
