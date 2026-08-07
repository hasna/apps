import type { Database, SQLQueryBindings } from "bun:sqlite";
import type {
  PlanProjectLinkReceipt,
  PlanProjectLinkResult,
  PlanProjectLinkRollbackResult,
  Task,
} from "../types/index.js";
import type {
  TodosPlanProjectLinkApplyInput,
  TodosPlanProjectLinkRollbackInput,
} from "../storage/interfaces.js";
import {
  PLAN_PROJECT_LINK_SCHEMA_VERSION,
  PlanProjectLinkError,
  assertPlanProjectLinkReceipt,
  planProjectLinkRequestHash,
  planProjectLinkResultDigest,
} from "../lib/plan-project-link-contract.js";
import { getDatabase } from "./database.js";
import { guardPlanRowsSqlite } from "./plan-row-serialization.js";
import { getPlan } from "./plans.js";
import { getProject } from "./projects.js";
import { listTasks } from "./tasks.js";

interface StoredApplyRow {
  payload_hash: string;
  payload: string;
}

interface StoredRollbackRow {
  payload: string;
}

export function getPlanProjectLinkReceipt(receiptId: string, db?: Database): PlanProjectLinkReceipt | null {
  const d = db || getDatabase();
  const row = d.query("SELECT payload FROM plan_project_link_receipts WHERE receipt_id = ?")
    .get(receiptId) as { payload: string } | null;
  return row ? assertPlanProjectLinkReceipt(JSON.parse(row.payload)) : null;
}

export function getPlanProjectLinkReceiptByIdempotencyKey(
  idempotencyKey: string,
  db?: Database,
): PlanProjectLinkReceipt | null {
  const d = db || getDatabase();
  const row = d.query("SELECT payload FROM plan_project_link_receipts WHERE idempotency_key = ?")
    .get(idempotencyKey) as { payload: string } | null;
  return row ? assertPlanProjectLinkReceipt(JSON.parse(row.payload)) : null;
}

function exactTasks(planId: string, db: Database): Task[] {
  return listTasks({ plan_id: planId, include_subtasks: true, include_archived: true }, db)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function currentResult(
  planId: string,
  projectId: string,
  receipt: PlanProjectLinkReceipt,
  db: Database,
  action: "linked" | "already_linked",
): PlanProjectLinkResult {
  const plan = getPlan(planId, db);
  const project = getProject(projectId, db);
  if (!plan || !project) {
    throw new PlanProjectLinkError(
      "PLAN_PROJECT_LINK_RESULT_DRIFT",
      "An accepted plan-project-link target no longer resolves",
      { plan_id: planId, project_id: projectId, receipt_id: receipt.receipt_id },
    );
  }
  const tasks = exactTasks(planId, db);
  if (planProjectLinkResultDigest(plan, tasks) !== receipt.result_digest) {
    throw new PlanProjectLinkError(
      "PLAN_PROJECT_LINK_RESULT_DRIFT",
      "The accepted plan-project-link result has drifted",
      { plan_id: planId, project_id: projectId, receipt_id: receipt.receipt_id },
    );
  }
  return { mode: "apply", action, plan, project, tasks, receipt };
}

export function applyPlanProjectLinkSqlite(
  input: TodosPlanProjectLinkApplyInput,
  db?: Database,
): PlanProjectLinkResult {
  const d = db || getDatabase();
  const mutate = d.transaction((): PlanProjectLinkResult => {
    guardPlanRowsSqlite([input.plan_id], d);
    const requestHash = planProjectLinkRequestHash(input.plan_id, input.project_id);
    const existingRow = d.query(
      "SELECT payload_hash, payload FROM plan_project_link_receipts WHERE idempotency_key = ?",
    ).get(input.idempotency_key) as StoredApplyRow | null;
    if (existingRow) {
      if (existingRow.payload_hash !== requestHash) {
        throw new PlanProjectLinkError(
          "PLAN_PROJECT_LINK_IDEMPOTENCY_CONFLICT",
          "The idempotency key was already accepted for a different plan-project link",
          { idempotency_key: input.idempotency_key },
        );
      }
      const rolledBack = d.query(
        "SELECT rollback_receipt_id FROM plan_project_link_rollback_receipts WHERE accepted_receipt_id = ?",
      ).get(input.receipt_id);
      if (rolledBack) {
        throw new PlanProjectLinkError(
          "PLAN_PROJECT_LINK_IDEMPOTENCY_CONFLICT",
          "The accepted plan-project link has already been rolled back",
          { receipt_id: input.receipt_id },
        );
      }
      return currentResult(
        input.plan_id,
        input.project_id,
        assertPlanProjectLinkReceipt(JSON.parse(existingRow.payload)),
        d,
        "already_linked",
      );
    }

    const plan = getPlan(input.plan_id, d);
    if (!plan) {
      throw new PlanProjectLinkError("PLAN_PROJECT_LINK_PLAN_NOT_FOUND", `Plan not found: ${input.plan_id}`);
    }
    const project = getProject(input.project_id, d);
    if (!project) {
      throw new PlanProjectLinkError("PLAN_PROJECT_LINK_PROJECT_NOT_FOUND", `Project not found: ${input.project_id}`);
    }
    if (plan.updated_at !== input.expected_plan_revision) {
      throw new PlanProjectLinkError(
        "PLAN_PROJECT_LINK_PLAN_REVISION_CONFLICT",
        "Plan changed after the link plan; fetch a fresh plan before applying",
        { expected_plan_revision: input.expected_plan_revision, current_plan_revision: plan.updated_at },
      );
    }
    if (project.updated_at !== input.expected_project_revision) {
      throw new PlanProjectLinkError(
        "PLAN_PROJECT_LINK_PROJECT_REVISION_CONFLICT",
        "Destination project changed after the link plan; fetch a fresh plan before applying",
        { expected_project_revision: input.expected_project_revision, current_project_revision: project.updated_at },
      );
    }
    if (plan.slug) {
      const collision = d.query(
        "SELECT id FROM plans WHERE project_id = ? AND slug = ? AND id <> ? LIMIT 1",
      ).get(project.id, plan.slug, plan.id) as { id: string } | null;
      if (collision) {
        throw new PlanProjectLinkError(
          "PLAN_PROJECT_LINK_SCOPE_COLLISION",
          "Another plan already owns this slug in the destination project",
          { conflicting_plan_id: collision.id, slug: plan.slug },
        );
      }
    }

    const beforeTasks = exactTasks(plan.id, d);
    const alreadyLinked = plan.project_id === project.id
      && beforeTasks.every((task) => task.project_id === project.id);
    const priorTaskProjectIds = Object.fromEntries(
      beforeTasks.map((task) => [task.id, task.project_id]),
    ) as Record<string, string | null>;
    const timestamp = input.created_at;

    if (plan.project_id !== project.id) {
      d.run("UPDATE plans SET project_id = ?, updated_at = ? WHERE id = ? AND updated_at = ?", [
        project.id,
        timestamp,
        plan.id,
        input.expected_plan_revision,
      ]);
    }
    for (const task of beforeTasks) {
      if (task.project_id === project.id) continue;
      d.run(
        "UPDATE tasks SET project_id = ?, updated_at = ?, version = version + 1 WHERE id = ? AND plan_id = ?",
        [project.id, timestamp, task.id, plan.id],
      );
    }

    const linkedPlan = getPlan(plan.id, d)!;
    const linkedTasks = exactTasks(plan.id, d);
    if (
      linkedPlan.project_id !== project.id
      || linkedTasks.length !== beforeTasks.length
      || linkedTasks.some((task) => task.project_id !== project.id)
    ) {
      throw new PlanProjectLinkError(
        "PLAN_PROJECT_LINK_RESULT_DRIFT",
        "Atomic plan-project link readback did not preserve the exact plan membership",
        { plan_id: plan.id, project_id: project.id },
      );
    }
    const receipt: PlanProjectLinkReceipt = {
      schema_version: PLAN_PROJECT_LINK_SCHEMA_VERSION,
      receipt_id: input.receipt_id,
      idempotency_key: input.idempotency_key,
      plan_id: plan.id,
      project_id: project.id,
      prior_plan_project_id: plan.project_id,
      prior_task_project_ids: priorTaskProjectIds,
      task_ids: beforeTasks.map((task) => task.id),
      task_count: beforeTasks.length,
      result_plan_revision: linkedPlan.updated_at,
      result_digest: planProjectLinkResultDigest(linkedPlan, linkedTasks),
      rollback_supported: true,
      created_at: input.created_at,
    };
    d.run(
      `INSERT INTO plan_project_link_receipts
       (receipt_id, idempotency_key, plan_id, project_id, payload_hash, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        receipt.receipt_id,
        receipt.idempotency_key,
        receipt.plan_id,
        receipt.project_id,
        requestHash,
        JSON.stringify(receipt),
        receipt.created_at,
      ],
    );
    return {
      mode: "apply",
      action: alreadyLinked ? "already_linked" : "linked",
      plan: linkedPlan,
      project,
      tasks: linkedTasks,
      receipt,
    };
  });
  return mutate();
}

export function rollbackPlanProjectLinkSqlite(
  input: TodosPlanProjectLinkRollbackInput,
  db?: Database,
): PlanProjectLinkRollbackResult {
  const d = db || getDatabase();
  return d.transaction(() => {
    guardPlanRowsSqlite([input.plan_id], d);
    const priorRollback = d.query(
      "SELECT payload FROM plan_project_link_rollback_receipts WHERE accepted_receipt_id = ?",
    ).get(input.receipt_id) as StoredRollbackRow | null;
    if (priorRollback) return JSON.parse(priorRollback.payload) as PlanProjectLinkRollbackResult;

    const receipt = getPlanProjectLinkReceipt(input.receipt_id, d);
    if (!receipt || receipt.plan_id !== input.plan_id || receipt.project_id !== input.project_id) {
      throw new PlanProjectLinkError(
        "PLAN_PROJECT_LINK_RECEIPT_NOT_FOUND",
        "No exact plan-project-link receipt matches this rollback request",
        { receipt_id: input.receipt_id, plan_id: input.plan_id, project_id: input.project_id },
      );
    }
    const plan = getPlan(input.plan_id, d);
    if (!plan || plan.updated_at !== input.expected_plan_revision) {
      throw new PlanProjectLinkError(
        "PLAN_PROJECT_LINK_PLAN_REVISION_CONFLICT",
        "Plan changed after the accepted link; fetch an exact readback before rollback",
        { expected_plan_revision: input.expected_plan_revision, current_plan_revision: plan?.updated_at ?? null },
      );
    }
    const tasks = exactTasks(plan.id, d);
    if (
      planProjectLinkResultDigest(plan, tasks) !== receipt.result_digest
      || tasks.length !== receipt.task_ids.length
      || tasks.some((task, index) => task.id !== receipt.task_ids[index])
    ) {
      throw new PlanProjectLinkError(
        "PLAN_PROJECT_LINK_ROLLBACK_CONFLICT",
        "Plan membership or project linkage drifted; refusing conditional rollback",
        { receipt_id: receipt.receipt_id },
      );
    }

    d.run("UPDATE plans SET project_id = ?, updated_at = ? WHERE id = ? AND updated_at = ?", [
      receipt.prior_plan_project_id,
      input.restored_at,
      plan.id,
      input.expected_plan_revision,
    ] as SQLQueryBindings[]);
    for (const task of tasks) {
      const priorProjectId = receipt.prior_task_project_ids[task.id];
      if (priorProjectId === undefined && !(task.id in receipt.prior_task_project_ids)) {
        throw new PlanProjectLinkError(
          "PLAN_PROJECT_LINK_ROLLBACK_CONFLICT",
          "Receipt does not contain the exact prior project for every member task",
          { task_id: task.id, receipt_id: receipt.receipt_id },
        );
      }
      d.run(
        "UPDATE tasks SET project_id = ?, updated_at = ?, version = version + 1 WHERE id = ? AND plan_id = ?",
        [priorProjectId, input.restored_at, task.id, plan.id] as SQLQueryBindings[],
      );
    }

    const restoredPlan = getPlan(plan.id, d)!;
    const restoredTasks = exactTasks(plan.id, d);
    if (
      restoredPlan.project_id !== receipt.prior_plan_project_id
      || restoredTasks.some((task) => task.project_id !== receipt.prior_task_project_ids[task.id])
    ) {
      throw new PlanProjectLinkError(
        "PLAN_PROJECT_LINK_ROLLBACK_CONFLICT",
        "Rollback readback did not restore every exact prior project id",
        { receipt_id: receipt.receipt_id },
      );
    }
    const result: PlanProjectLinkRollbackResult = {
      schema_version: PLAN_PROJECT_LINK_SCHEMA_VERSION,
      action: "restored",
      plan: restoredPlan,
      tasks: restoredTasks,
      accepted_receipt_id: receipt.receipt_id,
      rollback_receipt_id: input.rollback_receipt_id,
      restored_at: input.restored_at,
    };
    d.run(
      `INSERT INTO plan_project_link_rollback_receipts
       (rollback_receipt_id, accepted_receipt_id, payload, created_at)
       VALUES (?, ?, ?, ?)`,
      [result.rollback_receipt_id, result.accepted_receipt_id, JSON.stringify(result), result.restored_at],
    );
    return result;
  })();
}
