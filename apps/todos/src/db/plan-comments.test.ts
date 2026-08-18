import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import { resetConfig } from "../lib/config.js";
import { addPlanComment, getPlanComment, listPlanComments } from "./plan-comments.js";
import { createPlan, deletePlan, getPlan } from "./plans.js";
import { createTask } from "./tasks.js";
import { addComment, listComments } from "./comments.js";
import { PlanNotFoundError } from "../types/index.js";

let db: Database;

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetConfig();
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  resetConfig();
});

describe("addPlanComment", () => {
  it("rejects a plan that does not exist with PlanNotFoundError", () => {
    expect(() =>
      addPlanComment(
        { plan_id: "missing-plan-id", content: "outcome" },
        db,
      ),
    ).toThrow(PlanNotFoundError);
  });

  it("round-trips a plan-level comment with attribution", () => {
    const plan = createPlan({ name: "Skills Plan" }, db);
    const comment = addPlanComment(
      {
        plan_id: plan.id,
        content: "Published 12 skills to the fleet.",
        agent_id: "backlog-bugs-execute",
        session_id: "session-1",
        type: "progress",
        progress_pct: 60,
      },
      db,
    );
    expect(comment.id).toBeTruthy();
    expect(comment.plan_id).toBe(plan.id);
    expect(comment.content).toBe("Published 12 skills to the fleet.");
    expect(comment.agent_id).toBe("backlog-bugs-execute");
    expect(comment.session_id).toBe("session-1");
    expect(comment.type).toBe("progress");
    expect(comment.progress_pct).toBe(60);
    expect(comment.created_at).toBeTruthy();

    const readBack = getPlanComment(comment.id, db);
    expect(readBack).toMatchObject(comment);
  });

  it("keeps plan comments off the task comment surface and vice versa", () => {
    const plan = createPlan({ name: "Plan A" }, db);
    const task = createTask({ title: "Task A" }, db);

    addPlanComment({ plan_id: plan.id, content: "plan outcome" }, db);
    addComment({ task_id: task.id, content: "task note" }, db);

    const planComments = listPlanComments(plan.id, db);
    expect(planComments).toHaveLength(1);
    expect(planComments[0]!.content).toBe("plan outcome");

    const taskComments = listComments(task.id, db);
    expect(taskComments).toHaveLength(1);
    expect(taskComments[0]!.content).toBe("task note");

    // The task surface must not surface plan comments, even though both rows
    // live in the same database.
    expect(listPlanComments(task.id, db)).toHaveLength(0);
    expect(listComments(plan.id, db)).toHaveLength(0);
  });

  it("deleting a plan cascades its comments", () => {
    const plan = createPlan({ name: "Ephemeral" }, db);
    addPlanComment({ plan_id: plan.id, content: "will die with the plan" }, db);
    expect(listPlanComments(plan.id, db)).toHaveLength(1);

    const deleted = deletePlan(plan.id, db);
    expect(deleted).toBe(true);
    expect(getPlan(plan.id, db)).toBeNull();
    expect(listPlanComments(plan.id, db)).toHaveLength(0);
  });

  it("lists plan comments oldest-first", () => {
    const plan = createPlan({ name: "Ordered" }, db);
    addPlanComment({ plan_id: plan.id, content: "first" }, db);
    addPlanComment({ plan_id: plan.id, content: "second" }, db);
    const comments = listPlanComments(plan.id, db);
    expect(comments.map((c) => c.content)).toEqual(["first", "second"]);
  });
});
