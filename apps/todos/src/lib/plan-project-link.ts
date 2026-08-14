import type {
  PlanProjectLinkResult,
  PlanProjectLinkRollbackResult,
} from "../types/index.js";
import type { TodosStorageAdapter } from "../storage/interfaces.js";
import {
  PlanProjectLinkError,
  normalizePlanProjectLinkIdempotencyKey,
  planProjectLinkReceiptId,
  planProjectLinkRollbackReceiptId,
} from "./plan-project-link-contract.js";

export {
  PLAN_PROJECT_LINK_SCHEMA_VERSION,
  PlanProjectLinkError,
} from "./plan-project-link-contract.js";

async function exactPlanProjectLinkState(
  store: TodosStorageAdapter,
  planId: string,
  projectId: string,
): Promise<Omit<PlanProjectLinkResult, "mode" | "action" | "receipt">> {
  const [plan, project] = await Promise.all([
    store.plans.get(planId),
    store.projects.get(projectId),
  ]);
  if (!plan) {
    throw new PlanProjectLinkError(
      "PLAN_PROJECT_LINK_PLAN_NOT_FOUND",
      `Plan not found: ${planId}`,
      { plan_id: planId },
    );
  }
  if (!project) {
    throw new PlanProjectLinkError(
      "PLAN_PROJECT_LINK_PROJECT_NOT_FOUND",
      `Project not found: ${projectId}`,
      { project_id: projectId },
    );
  }
  const [tasks, projectPlans] = await Promise.all([
    store.tasks.list({ plan_id: plan.id, include_subtasks: true, include_archived: true }),
    store.plans.list(project.id),
  ]);
  const collision = projectPlans.find((candidate) =>
    candidate.id !== plan.id && candidate.slug !== null && candidate.slug === plan.slug
  );
  if (collision) {
    throw new PlanProjectLinkError(
      "PLAN_PROJECT_LINK_SCOPE_COLLISION",
      "Another plan already owns this slug in the destination project",
      { plan_id: plan.id, project_id: project.id, conflicting_plan_id: collision.id, slug: plan.slug },
    );
  }
  return {
    plan,
    project,
    tasks: tasks.sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export async function planPlanProjectLink(
  store: TodosStorageAdapter,
  planId: string,
  projectId: string,
): Promise<PlanProjectLinkResult> {
  const state = await exactPlanProjectLinkState(store, planId, projectId);
  const alreadyLinked = state.plan.project_id === state.project.id
    && state.tasks.every((task) => task.project_id === state.project.id);
  return {
    mode: "plan",
    action: alreadyLinked ? "already_linked" : "would_link",
    ...state,
    receipt: null,
  };
}

export async function applyPlanProjectLink(
  store: TodosStorageAdapter,
  planId: string,
  projectId: string,
  options: {
    expected_plan_revision: string;
    expected_project_revision: string;
    idempotency_key: string;
  },
): Promise<PlanProjectLinkResult> {
  if (!store.planProjectLinks) {
    throw new PlanProjectLinkError(
      "PLAN_PROJECT_LINK_UNSUPPORTED",
      "This storage backend cannot atomically link an existing plan and its tasks",
      { storage_kind: store.kind },
    );
  }
  const key = normalizePlanProjectLinkIdempotencyKey(options.idempotency_key);
  return store.planProjectLinks.apply({
    plan_id: planId,
    project_id: projectId,
    expected_plan_revision: options.expected_plan_revision,
    expected_project_revision: options.expected_project_revision,
    idempotency_key: key,
    receipt_id: planProjectLinkReceiptId(key),
    created_at: new Date().toISOString(),
  });
}

export async function rollbackPlanProjectLink(
  store: TodosStorageAdapter,
  planId: string,
  projectId: string,
  options: { receipt_id: string; expected_plan_revision: string },
): Promise<PlanProjectLinkRollbackResult> {
  if (!store.planProjectLinks) {
    throw new PlanProjectLinkError(
      "PLAN_PROJECT_LINK_UNSUPPORTED",
      "This storage backend cannot atomically roll back an existing plan project link",
      { storage_kind: store.kind },
    );
  }
  return store.planProjectLinks.rollback({
    plan_id: planId,
    project_id: projectId,
    receipt_id: options.receipt_id,
    expected_plan_revision: options.expected_plan_revision,
    rollback_receipt_id: planProjectLinkRollbackReceiptId(options.receipt_id),
    restored_at: new Date().toISOString(),
  });
}
