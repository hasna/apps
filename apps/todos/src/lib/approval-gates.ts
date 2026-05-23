/**
 * Local approval gates and manual checkpoints — request, approve, reject, blocked/ready.
 */

import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "../db/database.js";
import { getTask, updateTask, listTasks, type Task } from "../db/tasks.js";
import { addComment } from "../db/comments.js";
import { logTaskChange } from "../db/audit.js";
import { upsertCheckpoint, getCheckpoint, type Checkpoint } from "../db/checkpoints.js";
import { setTaskStatus } from "../db/task-status.js";

export const APPROVAL_GATE_SCHEMA = "todos.approval_gate.v1";

export const GATE_TYPES = ["start", "complete", "checkpoint", "plan_step"] as const;
export type GateType = (typeof GATE_TYPES)[number];

export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export interface ApprovalRequest {
  id: string;
  task_id: string;
  plan_id: string | null;
  checkpoint_step: string | null;
  gate_type: GateType;
  status: ApprovalStatus;
  requested_by: string | null;
  reviewed_by: string | null;
  note: string | null;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface RequestApprovalInput {
  task_id: string;
  gate_type: GateType;
  checkpoint_step?: string;
  note?: string;
  requested_by?: string;
}

export interface TaskGateStatus {
  task_id: string;
  ready_to_start: boolean;
  ready_to_complete: boolean;
  blocked_reasons: string[];
  pending_requests: ApprovalRequest[];
}

interface ApprovalRow {
  id: string;
  task_id: string;
  plan_id: string | null;
  checkpoint_step: string | null;
  gate_type: string;
  status: string;
  requested_by: string | null;
  reviewed_by: string | null;
  note: string | null;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
}

function rowToRequest(row: ApprovalRow): ApprovalRequest {
  return {
    ...row,
    gate_type: row.gate_type as GateType,
    status: row.status as ApprovalStatus,
  };
}

function persistRequest(row: ApprovalRow, db: Database): ApprovalRequest {
  return rowToRequest(row);
}

export function requestApproval(input: RequestApprovalInput, db?: Database): ApprovalRequest {
  const d = db || getDatabase();
  const task = getTask(input.task_id, d);
  if (!task) throw new Error(`Task not found: ${input.task_id}`);

  const id = uuid();
  const ts = now();
  d.run(
    `INSERT INTO task_approval_requests (
      id, task_id, plan_id, checkpoint_step, gate_type, status, requested_by, note, created_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [
      id,
      input.task_id,
      task.plan_id ?? null,
      input.checkpoint_step ?? null,
      input.gate_type,
      input.requested_by ?? null,
      input.note ?? null,
      ts,
    ],
  );

  if (input.gate_type === "complete" || input.gate_type === "start") {
    updateTask(input.task_id, { requires_approval: true, version: task.version }, d);
  }

  if (input.checkpoint_step) {
    upsertCheckpoint(input.task_id, input.checkpoint_step, {
      status: "pending",
      data: { requires_approval: true, approval_request_id: id },
      agent_id: input.requested_by,
    }, d);
  }

  addComment({
    task_id: input.task_id,
    content: `[approval-request:${input.gate_type}] ${input.note || "Approval requested"}`,
    type: "comment",
    agent_id: input.requested_by,
  }, d);

  return persistRequest(d.query("SELECT * FROM task_approval_requests WHERE id = ?").get(id) as ApprovalRow, d);
}

export function getApprovalRequest(id: string, db?: Database): ApprovalRequest | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM task_approval_requests WHERE id = ?").get(id) as ApprovalRow | null;
  return row ? rowToRequest(row) : null;
}

export function listPendingApprovals(filter: {
  task_id?: string;
  plan_id?: string;
  gate_type?: GateType;
  limit?: number;
} = {}, db?: Database): ApprovalRequest[] {
  const d = db || getDatabase();
  const conditions = ["status = 'pending'"];
  const params: unknown[] = [];

  if (filter.task_id) {
    conditions.push("task_id = ?");
    params.push(filter.task_id);
  }
  if (filter.plan_id) {
    conditions.push("plan_id = ?");
    params.push(filter.plan_id);
  }
  if (filter.gate_type) {
    conditions.push("gate_type = ?");
    params.push(filter.gate_type);
  }

  const limit = filter.limit ?? 50;
  const rows = d.query(
    `SELECT * FROM task_approval_requests WHERE ${conditions.join(" AND ")} ORDER BY created_at ASC LIMIT ?`,
  ).all(...[...params, limit] as any) as ApprovalRow[];

  return rows.map(rowToRequest);
}

function reviewRequest(
  id: string,
  decision: "approved" | "rejected",
  reviewedBy: string,
  reviewNote?: string,
  db?: Database,
): ApprovalRequest {
  const d = db || getDatabase();
  const existing = getApprovalRequest(id, d);
  if (!existing) throw new Error(`Approval request not found: ${id}`);
  if (existing.status !== "pending") {
    throw new Error(`Approval request already ${existing.status}`);
  }

  const ts = now();
  d.run(
    `UPDATE task_approval_requests SET status = ?, reviewed_by = ?, review_note = ?, reviewed_at = ? WHERE id = ?`,
    [decision, reviewedBy, reviewNote ?? null, ts, id],
  );

  const task = getTask(existing.task_id, d)!;

  if (decision === "approved") {
    if (existing.gate_type === "complete" || existing.gate_type === "plan_step") {
      updateTask(existing.task_id, { approved_by: reviewedBy, version: task.version }, d);
    }
    if (existing.checkpoint_step) {
      upsertCheckpoint(existing.task_id, existing.checkpoint_step, {
        status: "completed",
        data: { requires_approval: true, approved: true, approval_request_id: id },
        completed_at: ts,
      }, d);
    }
    addComment({
      task_id: existing.task_id,
      content: `[approval-approved:${existing.gate_type}] ${reviewNote || "Approved"}`,
      agent_id: reviewedBy,
    }, d);
    logTaskChange(existing.task_id, "approve_gate", existing.gate_type, "pending", "approved", reviewedBy, d);
  } else {
    if (existing.checkpoint_step) {
      upsertCheckpoint(existing.task_id, existing.checkpoint_step, {
        status: "failed",
        error: reviewNote || "Approval rejected",
        data: { requires_approval: true, approved: false, approval_request_id: id },
        completed_at: ts,
      }, d);
    }
    addComment({
      task_id: existing.task_id,
      content: `[approval-rejected:${existing.gate_type}] ${reviewNote || "Rejected"}`,
      agent_id: reviewedBy,
    }, d);
    logTaskChange(existing.task_id, "reject_gate", existing.gate_type, "pending", "rejected", reviewedBy, d);
  }

  return getApprovalRequest(id, d)!;
}

export function approveGate(requestId: string, reviewedBy: string, reviewNote?: string, db?: Database): ApprovalRequest {
  return reviewRequest(requestId, "approved", reviewedBy, reviewNote, db);
}

export function rejectGate(requestId: string, reviewedBy: string, reviewNote?: string, db?: Database): ApprovalRequest {
  return reviewRequest(requestId, "rejected", reviewedBy, reviewNote, db);
}

export function createManualCheckpoint(
  taskId: string,
  step: string,
  options: { requires_approval?: boolean; requested_by?: string; note?: string } = {},
  db?: Database,
): { checkpoint: Checkpoint; approval_request?: ApprovalRequest } {
  const checkpoint = upsertCheckpoint(taskId, step, {
    status: "pending",
    data: { manual: true, requires_approval: !!options.requires_approval },
    agent_id: options.requested_by,
  }, db);

  if (options.requires_approval) {
    const request = requestApproval({
      task_id: taskId,
      gate_type: "checkpoint",
      checkpoint_step: step,
      note: options.note ?? `Manual checkpoint '${step}' requires approval`,
      requested_by: options.requested_by,
    }, db);
    return { checkpoint, approval_request: request };
  }

  return { checkpoint };
}

export function getTaskGateStatus(taskId: string, db?: Database): TaskGateStatus {
  const d = db || getDatabase();
  const task = getTask(taskId, d);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const pending = listPendingApprovals({ task_id: taskId }, d);
  const blocked: string[] = [];

  const startPending = pending.some((r) => r.gate_type === "start" || r.gate_type === "plan_step");
  const completePending = pending.some((r) => r.gate_type === "complete");
  const checkpointPending = pending.filter((r) => r.gate_type === "checkpoint");

  if (task.requires_approval && !task.approved_at && (completePending || pending.length === 0)) {
    blocked.push("Task requires approval before completion");
  }
  if (startPending) blocked.push("Start/plan-step approval pending");
  for (const cp of checkpointPending) {
    blocked.push(`Checkpoint '${cp.checkpoint_step}' approval pending`);
  }

  const checkpointRows = d.query(
    "SELECT step, status, data FROM task_checkpoints WHERE task_id = ? AND status = 'pending'",
  ).all(taskId) as Array<{ step: string; status: string; data: string }>;

  for (const row of checkpointRows) {
    try {
      const data = JSON.parse(row.data) as { requires_approval?: boolean };
      if (data.requires_approval) {
        const cp = getCheckpoint(taskId, row.step, d);
        if (cp?.status === "pending") blocked.push(`Checkpoint '${row.step}' not approved`);
      }
    } catch {
      // ignore
    }
  }

  return {
    task_id: taskId,
    ready_to_start: !startPending && task.status === "pending",
    ready_to_complete: blocked.filter((b) => !b.includes("completion")).length === 0
      && task.status === "in_progress"
      && (!task.requires_approval || !!task.approved_at),
    blocked_reasons: blocked,
    pending_requests: pending,
  };
}

export function assertTaskGate(taskId: string, gate: "start" | "complete", db?: Database): void {
  const status = getTaskGateStatus(taskId, db);
  if (gate === "start" && !status.ready_to_start) {
    throw new Error(`Task blocked from start: ${status.blocked_reasons.join("; ") || "not ready"}`);
  }
  if (gate === "complete") {
    const task = getTask(taskId, db)!;
    if (task.requires_approval && !task.approved_at) {
      throw new Error("Task requires approval before completion");
    }
    if (!status.ready_to_complete && task.status === "in_progress") {
      throw new Error(`Task blocked from completion: ${status.blocked_reasons.join("; ") || "not ready"}`);
    }
  }
}

/** Require approval on all tasks in a plan before they can start. */
export function enablePlanApprovalGates(planId: string, db?: Database): number {
  const d = db || getDatabase();
  const tasks = listTasks({ plan_id: planId, limit: 500 }, d);
  let count = 0;
  for (const task of tasks) {
    if (!task.requires_approval) {
      updateTask(task.id, { requires_approval: true, version: task.version }, d);
      requestApproval({
        task_id: task.id,
        gate_type: "plan_step",
        note: "Plan step requires approval before execution",
      }, d);
      count++;
    }
  }
  return count;
}

export function listTasksAwaitingApproval(projectId?: string, db?: Database): Task[] {
  const d = db || getDatabase();
  const pending = listPendingApprovals({ limit: 200 }, d);
  const taskIds = [...new Set(pending.map((r) => r.task_id))];
  const tasks: Task[] = [];
  for (const id of taskIds) {
    const task = getTask(id, d);
    if (task && (!projectId || task.project_id === projectId)) tasks.push(task);
  }
  return tasks;
}

export function approveTaskViaGate(taskId: string, reviewedBy: string, reviewNote?: string, db?: Database): Task {
  const d = db || getDatabase();
  const pending = listPendingApprovals({ task_id: taskId, gate_type: "complete" }, d);
  const planPending = listPendingApprovals({ task_id: taskId, gate_type: "plan_step" }, d);
  for (const req of [...pending, ...planPending]) {
    approveGate(req.id, reviewedBy, reviewNote, d);
  }

  const task = getTask(taskId, d)!;
  if (task.requires_approval && !task.approved_at) {
    return updateTask(taskId, { approved_by: reviewedBy, version: task.version }, d);
  }
  return task;
}

export function markCheckpointReady(taskId: string, step: string, db?: Database): Checkpoint {
  return upsertCheckpoint(taskId, step, { status: "running", started_at: now() }, db);
}

export function completeCheckpoint(taskId: string, step: string, db?: Database): Checkpoint {
  const cp = getCheckpoint(taskId, step, db);
  if (cp?.data && (cp.data as Record<string, unknown>).requires_approval && cp.status !== "completed") {
    throw new Error(`Checkpoint '${step}' requires approval before completion`);
  }
  return upsertCheckpoint(taskId, step, { status: "completed", completed_at: now() }, db);
}
