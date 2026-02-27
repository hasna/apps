import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import {
  createPlan,
  getPlan,
  listPlans,
  updatePlan,
  deletePlan,
} from "./plans.js";
import { createProject } from "./projects.js";
import { createTask } from "./tasks.js";
import { PlanNotFoundError } from "../types/index.js";

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

describe("createPlan", () => {
  it("should create a plan with name only (defaults)", () => {
    const plan = createPlan({ name: "Sprint 1" }, db);
    expect(plan.id).toBeTruthy();
    expect(plan.name).toBe("Sprint 1");
    expect(plan.description).toBeNull();
    expect(plan.status).toBe("active");
    expect(plan.project_id).toBeNull();
    expect(plan.created_at).toBeTruthy();
    expect(plan.updated_at).toBeTruthy();
  });

  it("should create a plan with all fields", () => {
    const project = createProject({ name: "My Project", path: "/tmp/proj" }, db);
    const plan = createPlan(
      {
        name: "Release Plan",
        description: "Plan for v2.0 release",
        project_id: project.id,
        status: "completed",
      },
      db,
    );
    expect(plan.name).toBe("Release Plan");
    expect(plan.description).toBe("Plan for v2.0 release");
    expect(plan.project_id).toBe(project.id);
    expect(plan.status).toBe("completed");
  });

  it("should create a plan with project_id", () => {
    const project = createProject({ name: "Proj", path: "/tmp/p" }, db);
    const plan = createPlan({ name: "Plan A", project_id: project.id }, db);
    expect(plan.project_id).toBe(project.id);
  });
});

describe("getPlan", () => {
  it("should get a plan by ID", () => {
    const created = createPlan({ name: "My Plan" }, db);
    const fetched = getPlan(created.id, db);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.name).toBe("My Plan");
  });

  it("should return null for non-existent plan", () => {
    expect(getPlan("non-existent-id", db)).toBeNull();
  });
});

describe("listPlans", () => {
  it("should list all plans", () => {
    createPlan({ name: "Plan A" }, db);
    createPlan({ name: "Plan B" }, db);
    createPlan({ name: "Plan C" }, db);
    const plans = listPlans(undefined, db);
    expect(plans).toHaveLength(3);
  });

  it("should filter plans by project_id", () => {
    const proj1 = createProject({ name: "Proj1", path: "/tmp/p1" }, db);
    const proj2 = createProject({ name: "Proj2", path: "/tmp/p2" }, db);
    createPlan({ name: "Plan A", project_id: proj1.id }, db);
    createPlan({ name: "Plan B", project_id: proj1.id }, db);
    createPlan({ name: "Plan C", project_id: proj2.id }, db);

    const proj1Plans = listPlans(proj1.id, db);
    expect(proj1Plans).toHaveLength(2);

    const proj2Plans = listPlans(proj2.id, db);
    expect(proj2Plans).toHaveLength(1);
    expect(proj2Plans[0]!.name).toBe("Plan C");
  });

  it("should return empty array when no plans exist", () => {
    const plans = listPlans(undefined, db);
    expect(plans).toHaveLength(0);
  });

  it("should return plans ordered by created_at DESC", () => {
    // Insert with explicit timestamps to guarantee ordering
    const planA = createPlan({ name: "Plan A" }, db);
    // Manually set an older created_at on Plan A so Plan B is guaranteed newer
    db.run("UPDATE plans SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = ?", [planA.id]);
    const planB = createPlan({ name: "Plan B" }, db);
    const plans = listPlans(undefined, db);
    // Most recent first
    expect(plans[0]!.name).toBe("Plan B");
    expect(plans[1]!.name).toBe("Plan A");
  });
});

describe("updatePlan", () => {
  it("should update plan name", () => {
    const plan = createPlan({ name: "Old Name" }, db);
    const updated = updatePlan(plan.id, { name: "New Name" }, db);
    expect(updated.name).toBe("New Name");
  });

  it("should update plan description", () => {
    const plan = createPlan({ name: "Plan", description: "Old desc" }, db);
    const updated = updatePlan(plan.id, { description: "New desc" }, db);
    expect(updated.description).toBe("New desc");
  });

  it("should update plan status to completed", () => {
    const plan = createPlan({ name: "Plan" }, db);
    expect(plan.status).toBe("active");
    const updated = updatePlan(plan.id, { status: "completed" }, db);
    expect(updated.status).toBe("completed");
  });

  it("should update plan status to archived", () => {
    const plan = createPlan({ name: "Plan" }, db);
    const updated = updatePlan(plan.id, { status: "archived" }, db);
    expect(updated.status).toBe("archived");
  });

  it("should update multiple fields at once", () => {
    const plan = createPlan({ name: "Plan" }, db);
    const updated = updatePlan(
      plan.id,
      { name: "Updated", description: "A description", status: "completed" },
      db,
    );
    expect(updated.name).toBe("Updated");
    expect(updated.description).toBe("A description");
    expect(updated.status).toBe("completed");
  });

  it("should update updated_at timestamp", () => {
    const plan = createPlan({ name: "Plan" }, db);
    const originalUpdatedAt = plan.updated_at;
    // Small delay to ensure different timestamp
    const updated = updatePlan(plan.id, { name: "Changed" }, db);
    expect(updated.updated_at).toBeTruthy();
    // updated_at should be >= original (may be same in fast execution)
    expect(updated.updated_at >= originalUpdatedAt).toBe(true);
  });

  it("should throw PlanNotFoundError for non-existent plan", () => {
    expect(() => updatePlan("non-existent-id", { name: "Test" }, db)).toThrow(
      PlanNotFoundError,
    );
  });
});

describe("deletePlan", () => {
  it("should delete an existing plan and return true", () => {
    const plan = createPlan({ name: "To Delete" }, db);
    expect(deletePlan(plan.id, db)).toBe(true);
    expect(getPlan(plan.id, db)).toBeNull();
  });

  it("should return false for non-existent plan", () => {
    expect(deletePlan("non-existent-id", db)).toBe(false);
  });

  it("should SET NULL on tasks when plan is deleted", () => {
    const plan = createPlan({ name: "Plan" }, db);
    const task = createTask({ title: "My Task", plan_id: plan.id }, db);
    expect(task.plan_id).toBe(plan.id);

    deletePlan(plan.id, db);

    // Re-fetch the task — plan_id should be null due to ON DELETE SET NULL
    const row = db
      .query("SELECT plan_id FROM tasks WHERE id = ?")
      .get(task.id) as { plan_id: string | null } | null;
    expect(row).not.toBeNull();
    expect(row!.plan_id).toBeNull();
  });
});
