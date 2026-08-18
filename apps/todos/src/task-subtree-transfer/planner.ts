import { canonicalDigest } from "./canonical.js";
import {
  TodosTaskSubtreeTransferError,
  type TodosTaskSubtreeTransferApplyRequest,
  type TodosTaskSubtreeTransferInspection,
  type TodosTaskSubtreeTransferPlanImage,
  type TodosTaskSubtreeTransferTaskImage,
} from "./types.js";

export interface TransferTaskRecord extends TodosTaskSubtreeTransferTaskImage {
  archived_at?: string | null;
}

export interface TransferPlanRecord extends TodosTaskSubtreeTransferPlanImage {}

export interface TransferSnapshot {
  source_tasks: TransferTaskRecord[];
  plan_tasks: TransferTaskRecord[];
  plans: TransferPlanRecord[];
  destination_project_found: boolean;
  destination_task_list_found: boolean;
  destination_parent_found: boolean;
}

export interface PreparedTransfer {
  inspection: TodosTaskSubtreeTransferInspection;
  prior_tasks: TodosTaskSubtreeTransferTaskImage[];
  prior_plans: TodosTaskSubtreeTransferPlanImage[];
  task_plan_targets: Map<string, string | null>;
}

function sortedTaskImage(task: TransferTaskRecord): TodosTaskSubtreeTransferTaskImage {
  return {
    task_id: task.task_id,
    project_id: task.project_id,
    parent_id: task.parent_id,
    plan_id: task.plan_id,
    task_list_id: task.task_list_id,
    version: task.version,
    updated_at: task.updated_at,
  };
}

export function sourcePopulationDigest(tasks: TransferTaskRecord[]): string {
  return canonicalDigest(tasks
    .map((task) => ({
      ...sortedTaskImage(task),
      archived_at: task.archived_at ?? null,
    }))
    .sort((left, right) => left.task_id.localeCompare(right.task_id)));
}

function closure(tasks: TransferTaskRecord[], rootTaskId: string): TransferTaskRecord[] {
  const byId = new Map(tasks.map((task) => [task.task_id, task]));
  if (!byId.has(rootTaskId)) {
    throw new TodosTaskSubtreeTransferError(
      "TODOS_TASK_SUBTREE_TRANSFER_NOT_FOUND",
      `Root task not found in the exact source project: ${rootTaskId}`,
      { root_task_id: rootTaskId },
    );
  }
  const children = new Map<string, string[]>();
  for (const task of tasks) {
    if (!task.parent_id) continue;
    const siblings = children.get(task.parent_id) ?? [];
    siblings.push(task.task_id);
    children.set(task.parent_id, siblings);
  }
  for (const ids of children.values()) ids.sort();

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const result: TransferTaskRecord[] = [];
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      throw new TodosTaskSubtreeTransferError(
        "TODOS_TASK_SUBTREE_TRANSFER_HIERARCHY_CYCLE",
        "Task hierarchy contains a cycle in the requested descendant closure",
        { task_id: id },
      );
    }
    if (visited.has(id)) return;
    const task = byId.get(id);
    if (!task) {
      throw new TodosTaskSubtreeTransferError(
        "TODOS_TASK_SUBTREE_TRANSFER_FOREIGN_REFERENCE",
        "Task hierarchy references a parent outside the exact source population",
        { task_id: id },
      );
    }
    visiting.add(id);
    result.push(task);
    for (const child of children.get(id) ?? []) visit(child);
    visiting.delete(id);
    visited.add(id);
  };
  visit(rootTaskId);
  return result.sort((left, right) => left.task_id.localeCompare(right.task_id));
}

export function prepareTransfer(
  snapshot: TransferSnapshot,
  input: TodosTaskSubtreeTransferApplyRequest | (Omit<TodosTaskSubtreeTransferApplyRequest,
    "version" | "operation_id" | "step_id" | "idempotency_key" | "precondition_digest"
    | "expected_root_parent_id" | "source_population_digest" | "expected_tasks" | "shared_plan_splits">),
): PreparedTransfer {
  if (
    !snapshot.destination_project_found
    || !snapshot.destination_task_list_found
    || !snapshot.destination_parent_found
  ) {
    throw new TodosTaskSubtreeTransferError(
      "TODOS_TASK_SUBTREE_TRANSFER_FOREIGN_REFERENCE",
      "Destination project, task list, or parent does not match the exact requested target",
    );
  }
  const moved = closure(snapshot.source_tasks, input.root_task_id);
  const movedIds = new Set(moved.map((task) => task.task_id));
  if (input.destination_parent_id && movedIds.has(input.destination_parent_id)) {
    throw new TodosTaskSubtreeTransferError(
      "TODOS_TASK_SUBTREE_TRANSFER_HIERARCHY_CYCLE",
      "Destination parent cannot be inside the transferred subtree",
      { destination_parent_id: input.destination_parent_id },
    );
  }
  const planIds = [...new Set(moved.map((task) => task.plan_id).filter((id): id is string => Boolean(id)))].sort();
  const allPlanTasks = new Map<string, TransferTaskRecord[]>();
  for (const task of snapshot.plan_tasks) {
    if (!task.plan_id) continue;
    const rows = allPlanTasks.get(task.plan_id) ?? [];
    rows.push(task);
    allPlanTasks.set(task.plan_id, rows);
  }
  const contained: string[] = [];
  const shared: string[] = [];
  const planById = new Map(snapshot.plans.map((plan) => [plan.plan_id, plan]));
  for (const planId of planIds) {
    const plan = planById.get(planId);
    if (!plan || plan.project_id !== input.source_project_id) {
      throw new TodosTaskSubtreeTransferError(
        "TODOS_TASK_SUBTREE_TRANSFER_PLAN_CONFLICT",
        "A moved task references a plan absent from the exact source project",
        { plan_id: planId },
      );
    }
    const members = allPlanTasks.get(planId) ?? [];
    if (members.length === 0) {
      throw new TodosTaskSubtreeTransferError(
        "TODOS_TASK_SUBTREE_TRANSFER_PLAN_CONFLICT",
        "A moved task references a plan with no authoritative task membership",
        { plan_id: planId },
      );
    }
    if (members.every((task) => movedIds.has(task.task_id))) contained.push(planId);
    else shared.push(planId);
  }
  const inspection: TodosTaskSubtreeTransferInspection = {
    source_project_id: input.source_project_id,
    destination_project_id: input.destination_project_id,
    destination_task_list_id: input.destination_task_list_id,
    root_task_id: input.root_task_id,
    destination_parent_id: input.destination_parent_id,
    expected_root_parent_id: moved.find((task) => task.task_id === input.root_task_id)!.parent_id,
    source_population_digest: sourcePopulationDigest(snapshot.source_tasks),
    expected_tasks: moved.map((task) => ({ task_id: task.task_id, version: task.version })),
    contained_plan_ids: contained,
    shared_plan_ids: shared,
    complete: true,
  };

  return {
    inspection,
    prior_tasks: moved.map(sortedTaskImage),
    prior_plans: contained.map((id) => planById.get(id)!),
    task_plan_targets: new Map(moved.map((task) => [task.task_id, task.plan_id])),
  };
}

export function validateApplySnapshot(
  prepared: PreparedTransfer,
  request: TodosTaskSubtreeTransferApplyRequest,
  plans: TransferPlanRecord[],
): void {
  if (request.expected_root_parent_id !== prepared.inspection.expected_root_parent_id) {
    throw new TodosTaskSubtreeTransferError(
      "TODOS_TASK_SUBTREE_TRANSFER_CAS_CONFLICT",
      "Root parent changed since inspection",
    );
  }
  if (request.source_population_digest !== prepared.inspection.source_population_digest) {
    throw new TodosTaskSubtreeTransferError(
      "TODOS_TASK_SUBTREE_TRANSFER_POPULATION_DRIFT",
      "Complete source-project task population changed since inspection",
    );
  }
  const expected = request.expected_tasks
    .map((task) => ({ task_id: task.task_id, version: task.version }))
    .sort((left, right) => left.task_id.localeCompare(right.task_id));
  if (JSON.stringify(expected) !== JSON.stringify(prepared.inspection.expected_tasks)) {
    const actualById = new Map(prepared.inspection.expected_tasks.map((task) => [task.task_id, task.version]));
    const sameIds = expected.length === prepared.inspection.expected_tasks.length
      && expected.every((task) => actualById.has(task.task_id));
    throw new TodosTaskSubtreeTransferError(
      sameIds
        ? "TODOS_TASK_SUBTREE_TRANSFER_CAS_CONFLICT"
        : "TODOS_TASK_SUBTREE_TRANSFER_CLOSURE_DRIFT",
      sameIds
        ? "At least one exact task version changed since inspection"
        : "Exact descendant closure changed since inspection",
    );
  }
  const requestedSources = request.shared_plan_splits
    .map((mapping) => mapping.source_plan_id)
    .sort();
  if (JSON.stringify(requestedSources) !== JSON.stringify(prepared.inspection.shared_plan_ids)) {
    throw new TodosTaskSubtreeTransferError(
      "TODOS_TASK_SUBTREE_TRANSFER_PARTIAL_PLAN",
      "Shared plans require one exact explicit destination-plan mapping each",
      {
        expected_shared_plan_ids: prepared.inspection.shared_plan_ids,
        received_shared_plan_ids: requestedSources,
      },
    );
  }
  const planById = new Map(plans.map((plan) => [plan.plan_id, plan]));
  const destinationIds = new Set<string>();
  for (const mapping of request.shared_plan_splits) {
    if (destinationIds.has(mapping.destination_plan_id)) {
      throw new TodosTaskSubtreeTransferError(
        "TODOS_TASK_SUBTREE_TRANSFER_PLAN_CONFLICT",
        "Two shared source plans cannot collapse into one destination plan",
      );
    }
    destinationIds.add(mapping.destination_plan_id);
    const destination = planById.get(mapping.destination_plan_id);
    if (
      !destination
      || destination.project_id !== request.destination_project_id
      || destination.task_list_id !== request.destination_task_list_id
    ) {
      throw new TodosTaskSubtreeTransferError(
        "TODOS_TASK_SUBTREE_TRANSFER_PLAN_CONFLICT",
        "Shared-plan destination does not match the exact destination project and task list",
        { destination_plan_id: mapping.destination_plan_id },
      );
    }
    for (const [taskId, planId] of prepared.task_plan_targets) {
      if (planId === mapping.source_plan_id) {
        prepared.task_plan_targets.set(taskId, mapping.destination_plan_id);
      }
    }
  }
}
