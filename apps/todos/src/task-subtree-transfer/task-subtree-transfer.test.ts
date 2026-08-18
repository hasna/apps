import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../db/schema.js";
import {
  TodosTaskSubtreeTransferError,
  createSqliteTodosTaskSubtreeTransferAuthority,
  deriveTodosTaskSubtreeTransferApplyPreconditionDigest,
  deriveTodosTaskSubtreeTransferIdempotencyKey,
  deriveTodosTaskSubtreeTransferRollbackPreconditionDigest,
  taskSubtreeTransferRequestDigest,
  taskSubtreeTransferRollbackRequestDigest,
  type TodosTaskSubtreeTransferApplyRequest,
} from "./index.js";

const SOURCE_PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const DESTINATION_PROJECT_ID = "20000000-0000-4000-8000-000000000002";
const DESTINATION_TASK_LIST_ID = "30000000-0000-4000-8000-000000000003";
const DESTINATION_PARENT_ID = "40000000-0000-4000-8000-000000000004";
const ROOT_TASK_ID = "50000000-0000-4000-8000-000000000005";
const CHILD_TASK_ID = "60000000-0000-4000-8000-000000000006";
const LEAF_TASK_ID = "70000000-0000-4000-8000-000000000007";
const RETAINED_TASK_ID = "80000000-0000-4000-8000-000000000008";
const CONTAINED_PLAN_ID = "90000000-0000-4000-8000-000000000009";
const SHARED_PLAN_ID = "a0000000-0000-4000-8000-00000000000a";
const DESTINATION_SPLIT_PLAN_ID = "b0000000-0000-4000-8000-00000000000b";
const COMMENT_ID = "d0000000-0000-4000-8000-00000000000d";
const NOW = "2026-08-18T20:00:00.000Z";

function insertProject(db: Database, id: string, name: string): void {
  db.run(
    `INSERT INTO projects (id, name, path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, name, `/disposable/${id}`, NOW, NOW],
  );
}

function insertPlan(
  db: Database,
  id: string,
  projectId: string,
  taskListId: string | null,
  name: string,
): void {
  db.run(
    `INSERT INTO plans (id, project_id, task_list_id, name, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    [id, projectId, taskListId, name, NOW, NOW],
  );
}

function insertTask(
  db: Database,
  input: {
    id: string;
    projectId: string;
    parentId?: string | null;
    planId?: string | null;
    taskListId?: string | null;
    title: string;
    status?: string;
    assignedTo?: string | null;
  },
): void {
  db.run(
    `INSERT INTO tasks (
      id, project_id, parent_id, plan_id, task_list_id, title, description,
      status, priority, assigned_to, tags, metadata, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'high', ?, '["transfer"]', '{"kept":true}', 1, ?, ?)`,
    [
      input.id,
      input.projectId,
      input.parentId ?? null,
      input.planId ?? null,
      input.taskListId ?? null,
      input.title,
      `${input.title} description`,
      input.status ?? "pending",
      input.assignedTo ?? null,
      NOW,
      NOW,
    ],
  );
}

function applyRequest(
  inspection: Awaited<ReturnType<ReturnType<typeof createSqliteTodosTaskSubtreeTransferAuthority>["inspect"]>>,
): TodosTaskSubtreeTransferApplyRequest {
  const base = {
    version: 1 as const,
    operation_id: "fleet-subtree-transfer",
    step_id: "apply",
    idempotency_key: "",
    precondition_digest: "",
    source_project_id: SOURCE_PROJECT_ID,
    destination_project_id: DESTINATION_PROJECT_ID,
    destination_task_list_id: DESTINATION_TASK_LIST_ID,
    root_task_id: ROOT_TASK_ID,
    expected_root_parent_id: null,
    destination_parent_id: DESTINATION_PARENT_ID,
    source_population_digest: inspection.source_population_digest,
    expected_tasks: inspection.expected_tasks.map((task) => ({ ...task })),
    shared_plan_splits: [
      {
        source_plan_id: SHARED_PLAN_ID,
        destination_plan_id: DESTINATION_SPLIT_PLAN_ID,
      },
    ],
  };
  const precondition_digest = deriveTodosTaskSubtreeTransferApplyPreconditionDigest(base);
  const request_digest = taskSubtreeTransferRequestDigest({ ...base, precondition_digest });
  return {
    ...base,
    precondition_digest,
    idempotency_key: deriveTodosTaskSubtreeTransferIdempotencyKey({
      operation_id: base.operation_id,
      step_id: base.step_id,
      direction: "apply",
      target_selector: ROOT_TASK_ID,
      request_digest,
      precondition_digest,
    }),
  };
}

describe("task-subtree-transfer SQLite authority", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    insertProject(db, SOURCE_PROJECT_ID, "Source");
    insertProject(db, DESTINATION_PROJECT_ID, "Destination");
    db.run(
      `INSERT INTO task_lists (id, project_id, slug, name, metadata, created_at, updated_at)
       VALUES (?, ?, 'destination', 'Destination', '{}', ?, ?)`,
      [DESTINATION_TASK_LIST_ID, DESTINATION_PROJECT_ID, NOW, NOW],
    );
    insertPlan(db, CONTAINED_PLAN_ID, SOURCE_PROJECT_ID, null, "Contained");
    insertPlan(db, SHARED_PLAN_ID, SOURCE_PROJECT_ID, null, "Shared");
    insertPlan(
      db,
      DESTINATION_SPLIT_PLAN_ID,
      DESTINATION_PROJECT_ID,
      DESTINATION_TASK_LIST_ID,
      "Shared split destination",
    );
    insertTask(db, {
      id: DESTINATION_PARENT_ID,
      projectId: DESTINATION_PROJECT_ID,
      taskListId: DESTINATION_TASK_LIST_ID,
      title: "Destination parent",
    });
    insertTask(db, {
      id: ROOT_TASK_ID,
      projectId: SOURCE_PROJECT_ID,
      planId: CONTAINED_PLAN_ID,
      title: "Root",
      status: "in_progress",
      assignedTo: "fleet",
    });
    insertTask(db, {
      id: CHILD_TASK_ID,
      projectId: SOURCE_PROJECT_ID,
      parentId: ROOT_TASK_ID,
      planId: CONTAINED_PLAN_ID,
      title: "Child",
    });
    insertTask(db, {
      id: LEAF_TASK_ID,
      projectId: SOURCE_PROJECT_ID,
      parentId: CHILD_TASK_ID,
      planId: SHARED_PLAN_ID,
      title: "Leaf",
    });
    insertTask(db, {
      id: RETAINED_TASK_ID,
      projectId: SOURCE_PROJECT_ID,
      planId: SHARED_PLAN_ID,
      title: "Retained",
    });
    db.run(
      "INSERT INTO task_dependencies (task_id, depends_on) VALUES (?, ?)",
      [LEAF_TASK_ID, ROOT_TASK_ID],
    );
    db.run(
      `INSERT INTO task_comments (id, task_id, content, type, created_at)
       VALUES (?, ?, 'preserved comment', 'comment', ?)`,
      [COMMENT_ID, CHILD_TASK_ID, NOW],
    );
  });

  afterEach(() => db.close());

  test("inspects, atomically transfers, idempotently replays, and CAS-rolls back the exact subtree", async () => {
    const authority = createSqliteTodosTaskSubtreeTransferAuthority({
      database: db,
      tenantId: "transfer-test",
      now: () => NOW,
    });
    const inspection = await authority.inspect({
      source_project_id: SOURCE_PROJECT_ID,
      destination_project_id: DESTINATION_PROJECT_ID,
      destination_task_list_id: DESTINATION_TASK_LIST_ID,
      root_task_id: ROOT_TASK_ID,
      destination_parent_id: DESTINATION_PARENT_ID,
    });
    expect(inspection).toMatchObject({
      expected_tasks: [
        { task_id: ROOT_TASK_ID, version: 1 },
        { task_id: CHILD_TASK_ID, version: 1 },
        { task_id: LEAF_TASK_ID, version: 1 },
      ],
      contained_plan_ids: [CONTAINED_PLAN_ID],
      shared_plan_ids: [SHARED_PLAN_ID],
      complete: true,
    });

    const request = applyRequest(inspection);
    const first = await authority.apply(request);
    const duplicate = await authority.apply(request);
    expect(first.duplicate).toBe(false);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.receipt.receipt_id).toBe(first.receipt.receipt_id);
    expect(first.receipt.prior_image.tasks).toHaveLength(3);
    expect(first.receipt.prior_image.plans).toHaveLength(1);

    expect(db.query(
      `SELECT id, project_id, parent_id, plan_id, task_list_id, status, assigned_to, version
       FROM tasks WHERE id IN (?, ?, ?, ?) ORDER BY id`,
    ).all(ROOT_TASK_ID, CHILD_TASK_ID, LEAF_TASK_ID, RETAINED_TASK_ID)).toEqual([
      {
        id: ROOT_TASK_ID,
        project_id: DESTINATION_PROJECT_ID,
        parent_id: DESTINATION_PARENT_ID,
        plan_id: CONTAINED_PLAN_ID,
        task_list_id: DESTINATION_TASK_LIST_ID,
        status: "in_progress",
        assigned_to: "fleet",
        version: 2,
      },
      {
        id: CHILD_TASK_ID,
        project_id: DESTINATION_PROJECT_ID,
        parent_id: ROOT_TASK_ID,
        plan_id: CONTAINED_PLAN_ID,
        task_list_id: DESTINATION_TASK_LIST_ID,
        status: "pending",
        assigned_to: null,
        version: 2,
      },
      {
        id: LEAF_TASK_ID,
        project_id: DESTINATION_PROJECT_ID,
        parent_id: CHILD_TASK_ID,
        plan_id: DESTINATION_SPLIT_PLAN_ID,
        task_list_id: DESTINATION_TASK_LIST_ID,
        status: "pending",
        assigned_to: null,
        version: 2,
      },
      {
        id: RETAINED_TASK_ID,
        project_id: SOURCE_PROJECT_ID,
        parent_id: null,
        plan_id: SHARED_PLAN_ID,
        task_list_id: null,
        status: "pending",
        assigned_to: null,
        version: 1,
      },
    ]);
    expect(db.query("SELECT project_id, task_list_id FROM plans WHERE id = ?")
      .get(CONTAINED_PLAN_ID)).toEqual({
      project_id: DESTINATION_PROJECT_ID,
      task_list_id: DESTINATION_TASK_LIST_ID,
    });
    expect(db.query("SELECT task_id, depends_on FROM task_dependencies WHERE task_id = ? AND depends_on = ?")
      .get(LEAF_TASK_ID, ROOT_TASK_ID)).toEqual({ task_id: LEAF_TASK_ID, depends_on: ROOT_TASK_ID });
    expect(db.query("SELECT task_id, content FROM task_comments WHERE id = ?")
      .get(COMMENT_ID)).toEqual({ task_id: CHILD_TASK_ID, content: "preserved comment" });
    expect(() => db.run(
      "UPDATE todos_task_subtree_transfer_receipts SET result_digest = 'changed'",
    )).toThrow(/immutable/);

    const rollbackBase = {
      receipt_id: first.receipt.receipt_id,
      operation_id: first.receipt.operation_id,
      step_id: "rollback",
      idempotency_key: "",
      precondition_digest: "",
    };
    const rollbackPrecondition = deriveTodosTaskSubtreeTransferRollbackPreconditionDigest({
      ...rollbackBase,
      apply_result_digest: first.receipt.result_digest,
    });
    const rollbackDigest = taskSubtreeTransferRollbackRequestDigest({
      ...rollbackBase,
      precondition_digest: rollbackPrecondition,
    });
    const rollbackRequest = {
      ...rollbackBase,
      precondition_digest: rollbackPrecondition,
      idempotency_key: deriveTodosTaskSubtreeTransferIdempotencyKey({
        operation_id: rollbackBase.operation_id,
        step_id: rollbackBase.step_id,
        direction: "rollback",
        target_selector: first.receipt.receipt_id,
        request_digest: rollbackDigest,
        precondition_digest: rollbackPrecondition,
      }),
    };
    const rolledBack = await authority.rollback(rollbackRequest);
    const duplicateRollback = await authority.rollback(rollbackRequest);
    expect(rolledBack.duplicate).toBe(false);
    expect(duplicateRollback.duplicate).toBe(true);
    expect(db.query(
      "SELECT id, project_id, parent_id, plan_id, task_list_id, version FROM tasks WHERE id IN (?, ?, ?) ORDER BY id",
    ).all(ROOT_TASK_ID, CHILD_TASK_ID, LEAF_TASK_ID)).toEqual([
      { id: ROOT_TASK_ID, project_id: SOURCE_PROJECT_ID, parent_id: null, plan_id: CONTAINED_PLAN_ID, task_list_id: null, version: 3 },
      { id: CHILD_TASK_ID, project_id: SOURCE_PROJECT_ID, parent_id: ROOT_TASK_ID, plan_id: CONTAINED_PLAN_ID, task_list_id: null, version: 3 },
      { id: LEAF_TASK_ID, project_id: SOURCE_PROJECT_ID, parent_id: CHILD_TASK_ID, plan_id: SHARED_PLAN_ID, task_list_id: null, version: 3 },
    ]);
    expect(db.query("SELECT project_id, task_list_id FROM plans WHERE id = ?")
      .get(CONTAINED_PLAN_ID)).toEqual({ project_id: SOURCE_PROJECT_ID, task_list_id: null });
  });

  test("rejects stale, wrong-population, partial-plan, wrong-list, and cyclic inputs with zero domain writes", async () => {
    const authority = createSqliteTodosTaskSubtreeTransferAuthority({ database: db });
    await expect(authority.inspect({
      source_project_id: SOURCE_PROJECT_ID,
      destination_project_id: SOURCE_PROJECT_ID,
      destination_task_list_id: DESTINATION_TASK_LIST_ID,
      root_task_id: ROOT_TASK_ID,
      destination_parent_id: null,
    })).rejects.toEqual(
      expect.objectContaining<TodosTaskSubtreeTransferError>({
        code: "TODOS_TASK_SUBTREE_TRANSFER_INVALID_INPUT",
      }),
    );
    const inspection = await authority.inspect({
      source_project_id: SOURCE_PROJECT_ID,
      destination_project_id: DESTINATION_PROJECT_ID,
      destination_task_list_id: DESTINATION_TASK_LIST_ID,
      root_task_id: ROOT_TASK_ID,
      destination_parent_id: DESTINATION_PARENT_ID,
    });
    const baseline = {
      tasks: db.query("SELECT id, project_id, parent_id, plan_id, task_list_id, version FROM tasks ORDER BY id").all(),
      plans: db.query("SELECT id, project_id, task_list_id, updated_at FROM plans ORDER BY id").all(),
      receipts: db.query("SELECT count(*) AS count FROM todos_task_subtree_transfer_receipts").get(),
    };

    const stale = applyRequest(inspection);
    stale.expected_tasks[0]!.version = 99;
    stale.precondition_digest = deriveTodosTaskSubtreeTransferApplyPreconditionDigest(stale);
    const staleRequestDigest = taskSubtreeTransferRequestDigest(stale);
    stale.idempotency_key = deriveTodosTaskSubtreeTransferIdempotencyKey({
      operation_id: stale.operation_id,
      step_id: stale.step_id,
      direction: "apply",
      target_selector: stale.root_task_id,
      request_digest: staleRequestDigest,
      precondition_digest: stale.precondition_digest,
    });
    await expect(authority.apply(stale)).rejects.toEqual(
      expect.objectContaining<TodosTaskSubtreeTransferError>({ code: "TODOS_TASK_SUBTREE_TRANSFER_CAS_CONFLICT" }),
    );

    const wrongPopulation = applyRequest(inspection);
    wrongPopulation.source_population_digest = "f".repeat(64);
    wrongPopulation.precondition_digest = deriveTodosTaskSubtreeTransferApplyPreconditionDigest(wrongPopulation);
    const wrongPopulationRequestDigest = taskSubtreeTransferRequestDigest(wrongPopulation);
    wrongPopulation.idempotency_key = deriveTodosTaskSubtreeTransferIdempotencyKey({
      operation_id: wrongPopulation.operation_id,
      step_id: wrongPopulation.step_id,
      direction: "apply",
      target_selector: wrongPopulation.root_task_id,
      request_digest: wrongPopulationRequestDigest,
      precondition_digest: wrongPopulation.precondition_digest,
    });
    await expect(authority.apply(wrongPopulation)).rejects.toEqual(
      expect.objectContaining<TodosTaskSubtreeTransferError>({ code: "TODOS_TASK_SUBTREE_TRANSFER_POPULATION_DRIFT" }),
    );

    const partialPlan = applyRequest(inspection);
    partialPlan.shared_plan_splits = [];
    partialPlan.precondition_digest = deriveTodosTaskSubtreeTransferApplyPreconditionDigest(partialPlan);
    const partialPlanRequestDigest = taskSubtreeTransferRequestDigest(partialPlan);
    partialPlan.idempotency_key = deriveTodosTaskSubtreeTransferIdempotencyKey({
      operation_id: partialPlan.operation_id,
      step_id: partialPlan.step_id,
      direction: "apply",
      target_selector: partialPlan.root_task_id,
      request_digest: partialPlanRequestDigest,
      precondition_digest: partialPlan.precondition_digest,
    });
    await expect(authority.apply(partialPlan)).rejects.toEqual(
      expect.objectContaining<TodosTaskSubtreeTransferError>({ code: "TODOS_TASK_SUBTREE_TRANSFER_PARTIAL_PLAN" }),
    );

    const wrongList = applyRequest(inspection);
    wrongList.destination_task_list_id = crypto.randomUUID();
    wrongList.precondition_digest = deriveTodosTaskSubtreeTransferApplyPreconditionDigest(wrongList);
    const wrongListRequestDigest = taskSubtreeTransferRequestDigest(wrongList);
    wrongList.idempotency_key = deriveTodosTaskSubtreeTransferIdempotencyKey({
      operation_id: wrongList.operation_id,
      step_id: wrongList.step_id,
      direction: "apply",
      target_selector: wrongList.root_task_id,
      request_digest: wrongListRequestDigest,
      precondition_digest: wrongList.precondition_digest,
    });
    await expect(authority.apply(wrongList)).rejects.toEqual(
      expect.objectContaining<TodosTaskSubtreeTransferError>({ code: "TODOS_TASK_SUBTREE_TRANSFER_FOREIGN_REFERENCE" }),
    );

    expect({
      tasks: db.query("SELECT id, project_id, parent_id, plan_id, task_list_id, version FROM tasks ORDER BY id").all(),
      plans: db.query("SELECT id, project_id, task_list_id, updated_at FROM plans ORDER BY id").all(),
      receipts: db.query("SELECT count(*) AS count FROM todos_task_subtree_transfer_receipts").get(),
    }).toEqual(baseline);

    db.run("UPDATE tasks SET parent_id = ? WHERE id = ?", [LEAF_TASK_ID, ROOT_TASK_ID]);
    await expect(authority.inspect({
      source_project_id: SOURCE_PROJECT_ID,
      destination_project_id: DESTINATION_PROJECT_ID,
      destination_task_list_id: DESTINATION_TASK_LIST_ID,
      root_task_id: ROOT_TASK_ID,
      destination_parent_id: DESTINATION_PARENT_ID,
    })).rejects.toEqual(
      expect.objectContaining<TodosTaskSubtreeTransferError>({ code: "TODOS_TASK_SUBTREE_TRANSFER_HIERARCHY_CYCLE" }),
    );
    expect(db.query("SELECT count(*) AS count FROM todos_task_subtree_transfer_receipts").get())
      .toEqual({ count: 0 });
  });

  test("rejects a moved task whose plan is absent from the exact source project", async () => {
    db.run(
      "UPDATE plans SET project_id = ? WHERE id = ?",
      [DESTINATION_PROJECT_ID, SHARED_PLAN_ID],
    );
    const authority = createSqliteTodosTaskSubtreeTransferAuthority({ database: db });
    await expect(authority.inspect({
      source_project_id: SOURCE_PROJECT_ID,
      destination_project_id: DESTINATION_PROJECT_ID,
      destination_task_list_id: DESTINATION_TASK_LIST_ID,
      root_task_id: ROOT_TASK_ID,
      destination_parent_id: DESTINATION_PARENT_ID,
    })).rejects.toEqual(
      expect.objectContaining<TodosTaskSubtreeTransferError>({
        code: "TODOS_TASK_SUBTREE_TRANSFER_PLAN_CONFLICT",
      }),
    );
    expect(db.query("SELECT count(*) AS count FROM todos_task_subtree_transfer_receipts").get())
      .toEqual({ count: 0 });
    expect(db.query("SELECT project_id, version FROM tasks WHERE id = ?").get(ROOT_TASK_ID))
      .toEqual({ project_id: SOURCE_PROJECT_ID, version: 1 });
  });

  test("rolls every domain write back when a fault is injected before receipt commit", async () => {
    const cleanAuthority = createSqliteTodosTaskSubtreeTransferAuthority({ database: db });
    const inspection = await cleanAuthority.inspect({
      source_project_id: SOURCE_PROJECT_ID,
      destination_project_id: DESTINATION_PROJECT_ID,
      destination_task_list_id: DESTINATION_TASK_LIST_ID,
      root_task_id: ROOT_TASK_ID,
      destination_parent_id: DESTINATION_PARENT_ID,
    });
    const authority = createSqliteTodosTaskSubtreeTransferAuthority({
      database: db,
      faultInjector: async (point) => {
        await Promise.resolve();
        return point === "after_plan_writes";
      },
    });
    await expect(authority.apply(applyRequest(inspection))).rejects.toThrow(/Injected/);
    expect(db.query("SELECT project_id, version FROM tasks WHERE id = ?").get(ROOT_TASK_ID))
      .toEqual({ project_id: SOURCE_PROJECT_ID, version: 1 });
    expect(db.query("SELECT project_id FROM plans WHERE id = ?").get(CONTAINED_PLAN_ID))
      .toEqual({ project_id: SOURCE_PROJECT_ID });
    expect(db.query("SELECT count(*) AS count FROM todos_task_subtree_transfer_receipts").get())
      .toEqual({ count: 0 });
  });
});
