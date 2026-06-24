import { randomUUID } from "node:crypto";
import { getDb } from "../db/index.js";
import type { SessionStatus } from "../types/index.js";

export type RunStatus = SessionStatus;
export type LeaseStatus = "active" | "released" | "expired";
export const RUNTIME_RESOURCE_TYPES = [
  "computer_display",
  "terminal_session",
  "browser_extension_session",
  "fleet_machine",
] as const;
export type RuntimeResourceType = (typeof RUNTIME_RESOURCE_TYPES)[number];

export interface RuntimeGoal {
  id: string;
  title: string;
  prompt?: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  version: number;
  definition: Record<string, unknown>;
  created_at: string;
}

export interface WorkflowRun {
  id: string;
  goal_id?: string;
  workflow_id?: string;
  status: RunStatus;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  error?: string;
}

export interface RunStep {
  id: string;
  run_id: string;
  step_index: number;
  status: RunStatus;
  action?: unknown;
  result?: unknown;
  created_at: string;
  updated_at: string;
}

export interface RuntimeObservation {
  id: string;
  run_id: string;
  step_id?: string;
  kind: string;
  data: unknown;
  created_at: string;
}

export interface RuntimeApproval {
  id: string;
  run_id: string;
  capability: string;
  status: string;
  reason?: string;
  created_at: string;
  resolved_at?: string;
}

export interface RuntimeLease {
  id: string;
  resource_type: string;
  resource_id: string;
  run_id: string;
  holder?: string;
  status: LeaseStatus;
  acquired_at: string;
  expires_at?: string;
  released_at?: string;
}

export interface RuntimeArtifact {
  id: string;
  run_id: string;
  kind: string;
  path: string;
  sha256?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface RuntimePolicyDecision {
  id: string;
  run_id?: string;
  capability: string;
  decision: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

const LEGAL_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  pending: ["running", "cancelled"],
  running: ["waiting_on_approval", "paused", "cancelling", "cancelled", "failed", "completed", "max_steps_exceeded"],
  waiting_on_approval: ["running", "paused", "cancelling", "cancelled", "failed"],
  paused: ["running", "cancelling", "cancelled", "failed"],
  cancelling: ["cancelled", "failed"],
  cancelled: [],
  failed: [],
  completed: [],
  max_steps_exceeded: [],
};

function nowIso(): string {
  return new Date().toISOString();
}

function parseJsonField(value: unknown): unknown {
  if (typeof value !== "string" || !value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export function legalRunTransitions(status: RunStatus): RunStatus[] {
  return [...LEGAL_TRANSITIONS[status]];
}

export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (from === to) return;
  if (!LEGAL_TRANSITIONS[from].includes(to)) {
    throw new Error(`Invalid run transition: ${from} -> ${to}`);
  }
}

export function createRuntimeGoal(input: { title: string; prompt?: string; status?: string; id?: string }): RuntimeGoal {
  const goal: RuntimeGoal = {
    id: input.id ?? randomUUID(),
    title: input.title,
    prompt: input.prompt,
    status: input.status ?? "active",
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  getDb().prepare(`
    INSERT INTO runtime_goals (id, title, prompt, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(goal.id, goal.title, goal.prompt ?? null, goal.status, goal.created_at, goal.updated_at);
  return goal;
}

export function createWorkflowDefinition(input: { name: string; definition: Record<string, unknown>; version?: number; id?: string }): WorkflowDefinition {
  const workflow: WorkflowDefinition = {
    id: input.id ?? randomUUID(),
    name: input.name,
    version: input.version ?? 1,
    definition: input.definition,
    created_at: nowIso(),
  };
  getDb().prepare(`
    INSERT INTO workflow_definitions (id, name, version, definition_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(workflow.id, workflow.name, workflow.version, JSON.stringify(workflow.definition), workflow.created_at);
  return workflow;
}

export function createWorkflowRun(input: { goalId?: string; workflowId?: string; status?: RunStatus; id?: string }): WorkflowRun {
  const run: WorkflowRun = {
    id: input.id ?? randomUUID(),
    goal_id: input.goalId,
    workflow_id: input.workflowId,
    status: input.status ?? "pending",
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  getDb().prepare(`
    INSERT INTO workflow_runs (id, goal_id, workflow_id, status, created_at, updated_at, completed_at, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(run.id, run.goal_id ?? null, run.workflow_id ?? null, run.status, run.created_at, run.updated_at, null, null);
  return run;
}

export function getWorkflowRun(id: string): WorkflowRun | null {
  const row = getDb().prepare("SELECT * FROM workflow_runs WHERE id = ?").get(id) as any;
  return row ? rowToWorkflowRun(row) : null;
}

export function transitionWorkflowRun(id: string, nextStatus: RunStatus, options: { error?: string; clearError?: boolean } = {}): WorkflowRun {
  const current = getWorkflowRun(id);
  if (!current) throw new Error(`Workflow run not found: ${id}`);
  if (current.status === nextStatus) return current;
  assertRunTransition(current.status, nextStatus);
  const updated: WorkflowRun = {
    ...current,
    status: nextStatus,
    updated_at: nowIso(),
    completed_at: isTerminalStatus(nextStatus) ? nowIso() : current.completed_at,
    error: options.clearError ? undefined : options.error ?? current.error,
  };
  const result = getDb().prepare(`
    UPDATE workflow_runs SET status = ?, updated_at = ?, completed_at = ?, error = ?
    WHERE id = ? AND status = ?
  `).run(updated.status, updated.updated_at, updated.completed_at ?? null, updated.error ?? null, updated.id, current.status);
  if (result.changes !== 1) {
    const latest = getWorkflowRun(id);
    throw new Error(`Workflow run transition conflict: expected ${current.status}, got ${latest?.status ?? "missing"}`);
  }
  return updated;
}

export function addRunStep(input: { runId: string; stepIndex: number; status?: RunStatus; action?: unknown; result?: unknown; id?: string }): RunStep {
  const step: RunStep = {
    id: input.id ?? randomUUID(),
    run_id: input.runId,
    step_index: input.stepIndex,
    status: input.status ?? "running",
    action: input.action,
    result: input.result,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  getDb().prepare(`
    INSERT INTO run_steps (id, run_id, step_index, status, action_json, result_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    step.id,
    step.run_id,
    step.step_index,
    step.status,
    step.action === undefined ? null : JSON.stringify(step.action),
    step.result === undefined ? null : JSON.stringify(step.result),
    step.created_at,
    step.updated_at,
  );
  return step;
}

export function listRunSteps(runId: string): RunStep[] {
  return (getDb().prepare("SELECT * FROM run_steps WHERE run_id = ? ORDER BY step_index ASC").all(runId) as any[]).map(rowToRunStep);
}

export function addObservation(input: { runId: string; stepId?: string; kind: string; data: unknown; id?: string }): string {
  const id = input.id ?? randomUUID();
  getDb().prepare(`
    INSERT INTO observations (id, run_id, step_id, kind, data_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, input.runId, input.stepId ?? null, input.kind, JSON.stringify(input.data), nowIso());
  return id;
}

export function listObservations(runId: string): RuntimeObservation[] {
  return (getDb().prepare("SELECT * FROM observations WHERE run_id = ? ORDER BY created_at ASC").all(runId) as any[]).map(rowToObservation);
}

export function createApproval(input: { runId: string; capability: string; reason?: string; status?: string; id?: string }): string {
  const id = input.id ?? randomUUID();
  getDb().prepare(`
    INSERT INTO approvals (id, run_id, capability, status, reason, created_at, resolved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.runId, input.capability, input.status ?? "pending", input.reason ?? null, nowIso(), null);
  return id;
}

export function resolveApproval(id: string, status: string): RuntimeApproval | null {
  const existing = getDb().prepare("SELECT * FROM approvals WHERE id = ?").get(id) as any;
  if (!existing) return null;
  const resolvedAt = nowIso();
  getDb().prepare("UPDATE approvals SET status = ?, resolved_at = ? WHERE id = ?").run(status, resolvedAt, id);
  return { ...rowToApproval(existing), status, resolved_at: resolvedAt };
}

export function listApprovals(runId: string): RuntimeApproval[] {
  return (getDb().prepare("SELECT * FROM approvals WHERE run_id = ? ORDER BY created_at ASC").all(runId) as any[]).map(rowToApproval);
}

export function recordArtifact(input: { runId: string; kind: string; path: string; sha256?: string; metadata?: Record<string, unknown>; id?: string }): string {
  const id = input.id ?? randomUUID();
  getDb().prepare(`
    INSERT INTO artifacts (id, run_id, kind, path, sha256, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.runId, input.kind, input.path, input.sha256 ?? null, input.metadata ? JSON.stringify(input.metadata) : null, nowIso());
  return id;
}

export function listArtifacts(runId: string): RuntimeArtifact[] {
  return (getDb().prepare("SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at ASC").all(runId) as any[]).map(rowToArtifact);
}

export function recordPolicyDecision(input: { runId?: string; capability: string; decision: string; reason?: string; metadata?: Record<string, unknown>; id?: string }): string {
  const id = input.id ?? randomUUID();
  getDb().prepare(`
    INSERT INTO policy_decisions (id, run_id, capability, decision, reason, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.runId ?? null, input.capability, input.decision, input.reason ?? null, input.metadata ? JSON.stringify(input.metadata) : null, nowIso());
  return id;
}

export function listPolicyDecisions(runId?: string): RuntimePolicyDecision[] {
  const rows = runId
    ? getDb().prepare("SELECT * FROM policy_decisions WHERE run_id = ? ORDER BY created_at ASC").all(runId)
    : getDb().prepare("SELECT * FROM policy_decisions ORDER BY created_at ASC").all();
  return (rows as any[]).map(rowToPolicyDecision);
}

export function acquireRuntimeLease(input: {
  resourceType: RuntimeResourceType | string;
  resourceId: string;
  runId: string;
  holder?: string;
  ttlMs?: number;
  id?: string;
}): RuntimeLease {
  expireStaleRuntimeLeases();
  const existing = getDb().prepare(`
    SELECT * FROM resource_leases
    WHERE resource_type = ? AND resource_id = ? AND status = 'active'
    ORDER BY acquired_at ASC LIMIT 1
  `).get(input.resourceType, input.resourceId) as any;
  if (existing && existing.run_id !== input.runId) {
    throw new Error(`Resource lease already active for ${input.resourceType}:${input.resourceId} by run ${existing.run_id}`);
  }
  if (existing) {
    if (input.holder && existing.holder && existing.holder !== input.holder) {
      throw new Error(`Resource lease holder mismatch for ${input.resourceType}:${input.resourceId}`);
    }
    if (input.ttlMs) {
      const expiresAt = new Date(Date.now() + input.ttlMs).toISOString();
      getDb().prepare("UPDATE resource_leases SET holder = COALESCE(?, holder), expires_at = ? WHERE id = ? AND run_id = ? AND status = 'active'")
        .run(input.holder ?? null, expiresAt, existing.id, input.runId);
      return { ...rowToLease(existing), holder: input.holder ?? existing.holder ?? undefined, expires_at: expiresAt };
    }
    return rowToLease(existing);
  }

  const lease: RuntimeLease = {
    id: input.id ?? randomUUID(),
    resource_type: input.resourceType,
    resource_id: input.resourceId,
    run_id: input.runId,
    holder: input.holder,
    status: "active",
    acquired_at: nowIso(),
    expires_at: input.ttlMs ? new Date(Date.now() + input.ttlMs).toISOString() : undefined,
  };
  try {
    getDb().prepare(`
      INSERT INTO resource_leases (id, resource_type, resource_id, run_id, holder, status, acquired_at, expires_at, released_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      lease.id,
      lease.resource_type,
      lease.resource_id,
      lease.run_id,
      lease.holder ?? null,
      lease.status,
      lease.acquired_at,
      lease.expires_at ?? null,
      null,
    );
  } catch (error) {
    const active = getDb().prepare(`
      SELECT * FROM resource_leases
      WHERE resource_type = ? AND resource_id = ? AND status = 'active'
      ORDER BY acquired_at ASC LIMIT 1
    `).get(input.resourceType, input.resourceId) as any;
    if (active) {
      throw new Error(`Resource lease already active for ${input.resourceType}:${input.resourceId} by run ${active.run_id}`);
    }
    throw error;
  }
  return lease;
}

export function releaseRuntimeLease(id: string, owner: { runId: string; holder?: string }): RuntimeLease | null {
  expireStaleRuntimeLeases();
  const existing = getDb().prepare("SELECT * FROM resource_leases WHERE id = ?").get(id) as any;
  if (!existing) return null;
  if (existing.run_id !== owner.runId) {
    throw new Error(`Cannot release lease ${id}: owned by run ${existing.run_id}`);
  }
  if (owner.holder && existing.holder && existing.holder !== owner.holder) {
    throw new Error(`Cannot release lease ${id}: holder mismatch`);
  }
  if (existing.status !== "active") return rowToLease(existing);
  const releasedAt = nowIso();
  getDb().prepare("UPDATE resource_leases SET status = 'released', released_at = ? WHERE id = ? AND run_id = ? AND status = 'active'")
    .run(releasedAt, id, owner.runId);
  return { ...rowToLease(existing), status: "released", released_at: releasedAt };
}

export function listRuntimeLeases(opts: { status?: LeaseStatus; runId?: string } = {}): RuntimeLease[] {
  expireStaleRuntimeLeases();
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts.status) {
    conditions.push("status = ?");
    params.push(opts.status);
  }
  if (opts.runId) {
    conditions.push("run_id = ?");
    params.push(opts.runId);
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  return (getDb().prepare(`SELECT * FROM resource_leases${where} ORDER BY acquired_at DESC`).all(...params) as any[]).map(rowToLease);
}

export function expireStaleRuntimeLeases(now = nowIso()): number {
  return getDb().prepare(`
    UPDATE resource_leases SET status = 'expired', released_at = ?
    WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?
  `).run(now, now).changes;
}

export function isTerminalStatus(status: RunStatus): boolean {
  return status === "cancelled" || status === "failed" || status === "completed" || status === "max_steps_exceeded";
}

function rowToWorkflowRun(row: any): WorkflowRun {
  return {
    id: row.id,
    goal_id: row.goal_id ?? undefined,
    workflow_id: row.workflow_id ?? undefined,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at ?? undefined,
    error: row.error ?? undefined,
  };
}

function rowToRunStep(row: any): RunStep {
  return {
    id: row.id,
    run_id: row.run_id,
    step_index: row.step_index,
    status: row.status,
    action: parseJsonField(row.action_json),
    result: parseJsonField(row.result_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToObservation(row: any): RuntimeObservation {
  return {
    id: row.id,
    run_id: row.run_id,
    step_id: row.step_id ?? undefined,
    kind: row.kind,
    data: parseJsonField(row.data_json),
    created_at: row.created_at,
  };
}

function rowToApproval(row: any): RuntimeApproval {
  return {
    id: row.id,
    run_id: row.run_id,
    capability: row.capability,
    status: row.status,
    reason: row.reason ?? undefined,
    created_at: row.created_at,
    resolved_at: row.resolved_at ?? undefined,
  };
}

function rowToLease(row: any): RuntimeLease {
  return {
    id: row.id,
    resource_type: row.resource_type,
    resource_id: row.resource_id,
    run_id: row.run_id,
    holder: row.holder ?? undefined,
    status: row.status,
    acquired_at: row.acquired_at,
    expires_at: row.expires_at ?? undefined,
    released_at: row.released_at ?? undefined,
  };
}

function rowToArtifact(row: any): RuntimeArtifact {
  return {
    id: row.id,
    run_id: row.run_id,
    kind: row.kind,
    path: row.path,
    sha256: row.sha256 ?? undefined,
    metadata: parseJsonField(row.metadata_json) as Record<string, unknown> | undefined,
    created_at: row.created_at,
  };
}

function rowToPolicyDecision(row: any): RuntimePolicyDecision {
  return {
    id: row.id,
    run_id: row.run_id ?? undefined,
    capability: row.capability,
    decision: row.decision,
    reason: row.reason ?? undefined,
    metadata: parseJsonField(row.metadata_json) as Record<string, unknown> | undefined,
    created_at: row.created_at,
  };
}
