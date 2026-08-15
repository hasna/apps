import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createPlan, getPlan } from "../db/plans.js";
import { createProject } from "../db/projects.js";
import { createTask, getTask, updateTask } from "../db/tasks.js";
import { createLocalSqliteTodosStorageAdapter } from "../storage/local-sqlite.js";
import {
  PlanProjectLinkError,
  applyPlanProjectLink,
  planPlanProjectLink,
  rollbackPlanProjectLink,
} from "./plan-project-link.js";

describe("guarded existing plan project linkage", () => {
  let db: Database;

  beforeEach(() => {
    resetDatabase();
    db = getDatabase(":memory:");
  });

  afterEach(() => closeDatabase());

  test("plans, applies once, replays, rejects a reused key, and restores exact prior links", async () => {
    const destination = createProject({ name: "Dubai Fraud", path: "/tmp/dubai-fraud" }, db);
    const other = createProject({ name: "Other", path: "/tmp/other" }, db);
    const plan = createPlan({ name: "Authoritative", slug: "authoritative" }, db);
    const root = createTask({ title: "Root", plan_id: plan.id }, db);
    const child = createTask({ title: "Child", plan_id: plan.id, parent_id: root.id, project_id: other.id }, db);
    const store = createLocalSqliteTodosStorageAdapter({ db });

    const preview = await planPlanProjectLink(store, plan.id, destination.id);
    expect(preview).toMatchObject({ mode: "plan", action: "would_link", receipt: null });
    expect(preview.tasks.map((task) => task.id).sort()).toEqual([child.id, root.id].sort());

    const input = {
      expected_plan_revision: preview.plan.updated_at,
      expected_project_revision: preview.project.updated_at,
      idempotency_key: "link-authoritative-dubai",
    };
    const applied = await applyPlanProjectLink(store, plan.id, destination.id, input);
    const replay = await applyPlanProjectLink(store, plan.id, destination.id, input);
    expect(applied).toMatchObject({
      mode: "apply",
      action: "linked",
      receipt: {
        schema_version: "todos.plan-project-link.v1",
        idempotency_key: input.idempotency_key,
        plan_id: plan.id,
        project_id: destination.id,
        rollback_supported: true,
      },
    });
    expect(replay.receipt).toEqual(applied.receipt);
    expect(replay.action).toBe("already_linked");
    expect(getPlan(plan.id, db)?.project_id).toBe(destination.id);
    expect(getTask(root.id, db)?.project_id).toBe(destination.id);
    expect(getTask(child.id, db)?.project_id).toBe(destination.id);
    expect(getTask(child.id, db)?.parent_id).toBe(root.id);

    await expect(applyPlanProjectLink(store, plan.id, other.id, {
      expected_plan_revision: applied.plan.updated_at,
      expected_project_revision: other.updated_at,
      idempotency_key: input.idempotency_key,
    })).rejects.toMatchObject({ code: "PLAN_PROJECT_LINK_IDEMPOTENCY_CONFLICT" });

    const rolledBack = await rollbackPlanProjectLink(store, plan.id, destination.id, {
      receipt_id: applied.receipt!.receipt_id,
      expected_plan_revision: applied.plan.updated_at,
    });
    expect(rolledBack).toMatchObject({
      schema_version: "todos.plan-project-link.v1",
      action: "restored",
      accepted_receipt_id: applied.receipt!.receipt_id,
    });
    expect(getPlan(plan.id, db)?.project_id).toBeNull();
    expect(getTask(root.id, db)?.project_id).toBeNull();
    expect(getTask(child.id, db)?.project_id).toBe(other.id);
    expect(getTask(child.id, db)?.parent_id).toBe(root.id);
  });

  test("fails closed on stale plan and destination revisions", async () => {
    const destination = createProject({ name: "Destination", path: "/tmp/destination" }, db);
    const plan = createPlan({ name: "Plan" }, db);
    createTask({ title: "Task", plan_id: plan.id }, db);
    const store = createLocalSqliteTodosStorageAdapter({ db });

    await expect(applyPlanProjectLink(store, plan.id, destination.id, {
      expected_plan_revision: "stale-plan",
      expected_project_revision: destination.updated_at,
      idempotency_key: "stale-plan-revision",
    })).rejects.toBeInstanceOf(PlanProjectLinkError);
    await expect(applyPlanProjectLink(store, plan.id, destination.id, {
      expected_plan_revision: plan.updated_at,
      expected_project_revision: "stale-project",
      idempotency_key: "stale-project-revision",
    })).rejects.toMatchObject({ code: "PLAN_PROJECT_LINK_PROJECT_REVISION_CONFLICT" });
    expect(getPlan(plan.id, db)?.project_id).toBeNull();
  });

  test("keeps future plan membership linked by inheritance and conflict rejection", () => {
    const destination = createProject({ name: "Future Destination", path: "/tmp/link-future-destination" }, db);
    const other = createProject({ name: "Future Other", path: "/tmp/link-future-other" }, db);
    const plan = createPlan({ name: "Linked", project_id: destination.id }, db);

    const inherited = createTask({ title: "Inherited", plan_id: plan.id }, db);
    expect(inherited.project_id).toBe(destination.id);
    expect(() => createTask({
      title: "Conflicting create",
      plan_id: plan.id,
      project_id: other.id,
    }, db)).toThrow("project conflicts with linked plan");

    expect(() => updateTask(inherited.id, {
      project_id: other.id,
      version: inherited.version,
    }, db)).toThrow("project conflicts with linked plan");
    expect(getTask(inherited.id, db)).toMatchObject({
      id: inherited.id,
      plan_id: plan.id,
      project_id: destination.id,
    });
  });

  test("includes archived members in preview, receipt, link readback, and rollback", async () => {
    const destination = createProject({ name: "Archive Destination", path: "/tmp/archive-destination" }, db);
    const prior = createProject({ name: "Archive Prior", path: "/tmp/archive-prior" }, db);
    const plan = createPlan({ name: "Archive Complete" }, db);
    const active = createTask({ title: "Active member", plan_id: plan.id }, db);
    const archived = createTask({
      title: "Archived member",
      plan_id: plan.id,
      project_id: prior.id,
      status: "completed",
    }, db);
    db.run("UPDATE tasks SET archived_at = ? WHERE id = ?", ["2026-08-07T00:00:00.000Z", archived.id]);
    const store = createLocalSqliteTodosStorageAdapter({ db });

    const preview = await planPlanProjectLink(store, plan.id, destination.id);
    expect(preview.tasks.map((task) => task.id)).toEqual([active.id, archived.id].sort());

    const applied = await applyPlanProjectLink(store, plan.id, destination.id, {
      expected_plan_revision: preview.plan.updated_at,
      expected_project_revision: preview.project.updated_at,
      idempotency_key: "link-archived-members",
    });
    expect(applied.receipt).toMatchObject({
      task_ids: [active.id, archived.id].sort(),
      task_count: 2,
      prior_task_project_ids: {
        [active.id]: null,
        [archived.id]: prior.id,
      },
    });
    expect(getTask(archived.id, db)).toMatchObject({
      project_id: destination.id,
      archived_at: "2026-08-07T00:00:00.000Z",
    });

    const rolledBack = await rollbackPlanProjectLink(store, plan.id, destination.id, {
      receipt_id: applied.receipt!.receipt_id,
      expected_plan_revision: applied.plan.updated_at,
    });
    expect(rolledBack.tasks.map((task) => task.id)).toEqual([active.id, archived.id].sort());
    expect(getTask(active.id, db)?.project_id).toBeNull();
    expect(getTask(archived.id, db)).toMatchObject({
      project_id: prior.id,
      archived_at: "2026-08-07T00:00:00.000Z",
    });
  });

  test("serializes SQLite membership writes on the same guarded plan row", () => {
    const destination = createProject({ name: "Serialized Destination", path: "/tmp/serialized-destination" }, db);
    const plan = createPlan({ name: "Serialized", project_id: destination.id }, db);
    const statements: string[] = [];
    const instrumented = new Proxy(db, {
      get(target, property) {
        if (property === "run") {
          return (sql: string, ...bindings: unknown[]) => {
            statements.push(sql);
            return Reflect.apply(target.run, target, [sql, ...bindings]);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as Database;

    const task = createTask({ title: "Serialized member", plan_id: plan.id }, instrumented);
    expect(task.project_id).toBe(destination.id);
    const guardIndex = statements.findIndex((sql) => sql.includes("todos:sqlite-plan-row-guard"));
    const insertIndex = statements.findIndex((sql) => sql.includes("INSERT INTO tasks"));
    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(insertIndex).toBeGreaterThan(guardIndex);
  });
});
