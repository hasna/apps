import type { Database } from "bun:sqlite";
import { logTaskChange } from "../db/audit.js";
import { getCheckpoint, getTaskCheckpoints, upsertCheckpoint, type Checkpoint } from "../db/checkpoints.js";
import { getDatabase, now } from "../db/database.js";
import { addTaskRunEvent, getTaskRun, resolveTaskRunId } from "../db/task-runs.js";
import { getTask } from "../db/tasks.js";
import { TaskNotFoundError } from "../types/index.js";

export type ApprovalGateStatus = "pending" | "approved" | "rejected" | "expired";

export interface ApprovalGate {
  id: string;
  task_id: string;
  gate: string;
  status: ApprovalGateStatus;
  reviewer: string | null;
  requester: string | null;
  reason: string | null;
  note: string | null;
  plan_id: string | null;
  run_id: string | null;
  expires_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
  checkpoint: Checkpoint;
}

export interface RequestApprovalGateInput {
  task_id: string;
  gate: string;
  requester?: string;
  reviewer?: string;
  reason?: string;
  plan_id?: string;
  run_id?: string;
  expires_at?: string;
  metadata?: Record<string, unknown>;
}

export interface DecideApprovalGateInput {
  task_id: string;
  gate: string;
  reviewer?: string;
  note?: string;
  reason?: string;
}

export interface CheckApprovalGateResult {
  allowed: boolean;
  gate: ApprovalGate | null;
  reasons: string[];
}

function stepForGate(gate: string): string {
  const trimmed = gate.trim();
  if (!trimmed) throw new Error("Approval gate name is required");
  return `approval:${trimmed}`;
}

function approvalStatusToCheckpointStatus(status: ApprovalGateStatus): Checkpoint["status"] {
  if (status === "approved") return "completed";
  if (status === "pending") return "pending";
  return "failed";
}

function checkpointStatusToApprovalStatus(checkpoint: Checkpoint): ApprovalGateStatus {
  const value = checkpoint.data["approval_status"];
  if (value === "approved" || value === "rejected" || value === "expired" || value === "pending") return value;
  if (checkpoint.status === "completed") return "approved";
  if (checkpoint.status === "failed") return "rejected";
  return "pending";
}

function ensureTask(taskId: string, db: Database): void {
  if (!getTask(taskId, db)) throw new TaskNotFoundError(taskId);
}

function isExpired(expiresAt: string | null, at = new Date()): boolean {
  return Boolean(expiresAt && new Date(expiresAt).getTime() <= at.getTime());
}

function gateFromCheckpoint(checkpoint: Checkpoint): ApprovalGate {
  const status = checkpointStatusToApprovalStatus(checkpoint);
  return {
    id: checkpoint.id,
    task_id: checkpoint.task_id,
    gate: String(checkpoint.data["approval_gate_name"] || checkpoint.step.replace(/^approval:/, "")),
    status,
    reviewer: typeof checkpoint.data["reviewer"] === "string" ? checkpoint.data["reviewer"] : null,
    requester: typeof checkpoint.data["requester"] === "string" ? checkpoint.data["requester"] : null,
    reason: typeof checkpoint.data["reason"] === "string" ? checkpoint.data["reason"] : null,
    note: typeof checkpoint.data["note"] === "string" ? checkpoint.data["note"] : null,
    plan_id: typeof checkpoint.data["plan_id"] === "string" ? checkpoint.data["plan_id"] : null,
    run_id: typeof checkpoint.data["run_id"] === "string" ? checkpoint.data["run_id"] : null,
    expires_at: typeof checkpoint.data["expires_at"] === "string" ? checkpoint.data["expires_at"] : null,
    decided_by: typeof checkpoint.data["decided_by"] === "string" ? checkpoint.data["decided_by"] : null,
    decided_at: typeof checkpoint.data["decided_at"] === "string" ? checkpoint.data["decided_at"] : null,
    created_at: checkpoint.created_at,
    updated_at: checkpoint.updated_at,
    checkpoint,
  };
}

function logApprovalEvent(taskId: string, action: string, gate: ApprovalGate, agentId: string | undefined, db: Database): void {
  const payload = JSON.stringify({
    gate: gate.gate,
    status: gate.status,
    reviewer: gate.reviewer,
    requester: gate.requester,
    plan_id: gate.plan_id,
    run_id: gate.run_id,
    expires_at: gate.expires_at,
    decided_by: gate.decided_by,
    decided_at: gate.decided_at,
  });
  logTaskChange(taskId, `approval_gate.${action}`, "approval_gate", null, payload, agentId, db);
  if (gate.run_id && getTaskRun(gate.run_id, db)) {
    addTaskRunEvent({
      run_id: gate.run_id,
      event_type: "progress",
      message: `approval gate ${action}: ${gate.gate}`,
      data: JSON.parse(payload) as Record<string, unknown>,
      agent_id: agentId,
    }, db);
  }
}

function writeGate(
  input: RequestApprovalGateInput,
  status: ApprovalGateStatus,
  decision?: { decided_by?: string; decided_at?: string; note?: string; reason?: string },
  db?: Database,
): ApprovalGate {
  const d = db || getDatabase();
  ensureTask(input.task_id, d);
  const step = stepForGate(input.gate);
  const existing = getCheckpoint(input.task_id, step, d);
  const existingData = existing?.data || {};
  const timestamp = decision?.decided_at || now();
  const existingRunId = typeof existingData["run_id"] === "string" ? existingData["run_id"] : undefined;
  const runId = input.run_id ? resolveTaskRunId(input.run_id, d) : existingRunId;
  const data = {
    ...existingData,
    ...(input.metadata || {}),
    approval_gate: true,
    approval_gate_name: input.gate.trim(),
    approval_status: status,
    requester: input.requester ?? existingData["requester"] ?? null,
    reviewer: input.reviewer ?? decision?.decided_by ?? existingData["reviewer"] ?? null,
    reason: decision?.reason ?? input.reason ?? existingData["reason"] ?? null,
    note: decision?.note ?? existingData["note"] ?? null,
    plan_id: input.plan_id ?? existingData["plan_id"] ?? null,
    run_id: runId ?? null,
    expires_at: input.expires_at ?? existingData["expires_at"] ?? null,
    decided_by: decision?.decided_by ?? existingData["decided_by"] ?? null,
    decided_at: decision?.decided_at ?? existingData["decided_at"] ?? null,
  };
  const checkpoint = upsertCheckpoint(input.task_id, step, {
    agent_id: decision?.decided_by || input.requester || input.reviewer,
    status: approvalStatusToCheckpointStatus(status),
    data,
    error: status === "rejected" || status === "expired" ? String(data.reason || status) : null,
    started_at: existing?.started_at || timestamp,
    completed_at: status === "pending" ? null : timestamp,
  }, d);
  return gateFromCheckpoint(checkpoint);
}

function currentGate(taskId: string, gate: string, db: Database): ApprovalGate | null {
  const checkpoint = getCheckpoint(taskId, stepForGate(gate), db);
  return checkpoint ? gateFromCheckpoint(checkpoint) : null;
}

export function requestApprovalGate(input: RequestApprovalGateInput, db?: Database): ApprovalGate {
  const d = db || getDatabase();
  const existing = currentGate(input.task_id, input.gate, d);
  if (existing && existing.status !== "pending") {
    throw new Error(`Approval gate ${input.gate} is already ${existing.status}`);
  }
  const gate = writeGate(input, "pending", undefined, d);
  logApprovalEvent(input.task_id, "requested", gate, input.requester || input.reviewer, d);
  return gate;
}

export function approveApprovalGate(input: DecideApprovalGateInput, db?: Database): ApprovalGate {
  const d = db || getDatabase();
  const existing = currentGate(input.task_id, input.gate, d);
  if (!existing) throw new Error(`Approval gate not found: ${input.gate}`);
  if (existing.status !== "pending") throw new Error(`Approval gate ${input.gate} is already ${existing.status}`);
  if (isExpired(existing.expires_at)) throw new Error(`Approval gate ${input.gate} is expired`);
  const gate = writeGate({
    task_id: input.task_id,
    gate: input.gate,
    requester: existing.requester || undefined,
    reviewer: input.reviewer || existing.reviewer || undefined,
    reason: existing.reason || undefined,
    plan_id: existing.plan_id || undefined,
    run_id: existing.run_id || undefined,
    expires_at: existing.expires_at || undefined,
  }, "approved", { decided_by: input.reviewer, decided_at: now(), note: input.note }, d);
  logApprovalEvent(input.task_id, "approved", gate, input.reviewer, d);
  return gate;
}

export function rejectApprovalGate(input: DecideApprovalGateInput, db?: Database): ApprovalGate {
  const d = db || getDatabase();
  const existing = currentGate(input.task_id, input.gate, d);
  if (!existing) throw new Error(`Approval gate not found: ${input.gate}`);
  if (existing.status !== "pending") throw new Error(`Approval gate ${input.gate} is already ${existing.status}`);
  const gate = writeGate({
    task_id: input.task_id,
    gate: input.gate,
    requester: existing.requester || undefined,
    reviewer: input.reviewer || existing.reviewer || undefined,
    reason: existing.reason || undefined,
    plan_id: existing.plan_id || undefined,
    run_id: existing.run_id || undefined,
    expires_at: existing.expires_at || undefined,
  }, "rejected", { decided_by: input.reviewer, decided_at: now(), note: input.note, reason: input.reason || input.note }, d);
  logApprovalEvent(input.task_id, "rejected", gate, input.reviewer, d);
  return gate;
}

export function expireApprovalGate(input: DecideApprovalGateInput, db?: Database): ApprovalGate {
  const d = db || getDatabase();
  const existing = currentGate(input.task_id, input.gate, d);
  if (!existing) throw new Error(`Approval gate not found: ${input.gate}`);
  if (existing.status !== "pending") throw new Error(`Approval gate ${input.gate} is already ${existing.status}`);
  const gate = writeGate({
    task_id: input.task_id,
    gate: input.gate,
    requester: existing.requester || undefined,
    reviewer: existing.reviewer || undefined,
    reason: existing.reason || undefined,
    plan_id: existing.plan_id || undefined,
    run_id: existing.run_id || undefined,
    expires_at: existing.expires_at || undefined,
  }, "expired", { decided_by: input.reviewer, decided_at: now(), reason: input.reason || "expired" }, d);
  logApprovalEvent(input.task_id, "expired", gate, input.reviewer, d);
  return gate;
}

export function listApprovalGates(taskId: string, db?: Database): ApprovalGate[] {
  const d = db || getDatabase();
  ensureTask(taskId, d);
  return getTaskCheckpoints(taskId, d)
    .filter((checkpoint) => checkpoint.data["approval_gate"] === true || checkpoint.step.startsWith("approval:"))
    .map(gateFromCheckpoint);
}

export function checkApprovalGate(taskId: string, gateName: string, db?: Database): CheckApprovalGateResult {
  const d = db || getDatabase();
  ensureTask(taskId, d);
  const gate = currentGate(taskId, gateName, d);
  const reasons: string[] = [];
  if (!gate) reasons.push(`approval gate is required: ${gateName}`);
  else if (gate.status !== "approved") reasons.push(`approval gate ${gateName} is ${gate.status}`);
  if (gate && gate.status === "pending" && isExpired(gate.expires_at)) reasons.push(`approval gate ${gateName} is expired`);
  return { allowed: reasons.length === 0, gate, reasons };
}

export function assertApprovalGate(taskId: string, gateName: string, db?: Database): ApprovalGate {
  const result = checkApprovalGate(taskId, gateName, db);
  if (!result.allowed) throw new Error(result.reasons.join("; "));
  return result.gate!;
}
