import type { Loop, LoopRun, WorkflowSpec } from "../types.js";
import { HostedResponseShapeError } from "./hosted-errors.js";

const LOOP_STATUSES = new Set(["active", "paused", "stopped", "expired"]);
const RUN_STATUSES = new Set(["running", "succeeded", "failed", "timed_out", "abandoned", "skipped"]);
const WORKFLOW_STATUSES = new Set(["active", "archived"]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HostedResponseShapeError(`${label} to be an object`);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HostedResponseShapeError(`${label} to be a non-empty string`);
  }
  return value;
}

function timestamp(value: unknown, label: string): string {
  const text = nonEmptyString(value, label);
  if (!Number.isFinite(Date.parse(text))) {
    throw new HostedResponseShapeError(`${label} to be a valid timestamp`);
  }
  return text;
}

function oneOf(value: unknown, values: Set<string>, label: string): string {
  const text = nonEmptyString(value, label);
  if (!values.has(text)) {
    throw new HostedResponseShapeError(`${label} to be one of ${[...values].join(", ")}`);
  }
  return text;
}

export function hostedLoop(value: unknown, expectedId?: string): Loop {
  const row = record(value, "loop");
  const id = nonEmptyString(row.id, "loop.id");
  if (expectedId !== undefined && id !== expectedId) {
    throw new HostedResponseShapeError(`loop.id to equal requested id '${expectedId}'`);
  }
  nonEmptyString(row.name, "loop.name");
  oneOf(row.status, LOOP_STATUSES, "loop.status");
  record(row.schedule, "loop.schedule");
  record(row.target, "loop.target");
  timestamp(row.createdAt, "loop.createdAt");
  timestamp(row.updatedAt, "loop.updatedAt");
  return value as Loop;
}

export function hostedWorkflow(value: unknown, expectedId?: string): WorkflowSpec {
  const row = record(value, "workflow");
  const id = nonEmptyString(row.id, "workflow.id");
  if (expectedId !== undefined && id !== expectedId) {
    throw new HostedResponseShapeError(`workflow.id to equal requested id '${expectedId}'`);
  }
  nonEmptyString(row.name, "workflow.name");
  oneOf(row.status, WORKFLOW_STATUSES, "workflow.status");
  if (!Array.isArray(row.steps)) throw new HostedResponseShapeError("workflow.steps to be an array");
  timestamp(row.createdAt, "workflow.createdAt");
  timestamp(row.updatedAt, "workflow.updatedAt");
  return value as WorkflowSpec;
}

export function hostedRun(value: unknown, expected: { id?: string; loopId?: string } = {}): LoopRun {
  const row = record(value, "run");
  const id = nonEmptyString(row.id, "run.id");
  const loopId = nonEmptyString(row.loopId, "run.loopId");
  if (expected.id !== undefined && id !== expected.id) {
    throw new HostedResponseShapeError(`run.id to equal requested id '${expected.id}'`);
  }
  if (expected.loopId !== undefined && loopId !== expected.loopId) {
    throw new HostedResponseShapeError(`run.loopId to equal requested loop id '${expected.loopId}'`);
  }
  oneOf(row.status, RUN_STATUSES, "run.status");
  timestamp(row.scheduledFor, "run.scheduledFor");
  timestamp(row.createdAt, "run.createdAt");
  timestamp(row.updatedAt, "run.updatedAt");
  if (!Number.isSafeInteger(row.attempt) || Number(row.attempt) < 1) {
    throw new HostedResponseShapeError("run.attempt to be a positive safe integer");
  }
  return value as LoopRun;
}

export function uniqueHostedRows<T extends { id: string }>(rows: T[], label: string): T[] {
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) throw new HostedResponseShapeError(`${label} ids to be unique`);
    seen.add(row.id);
  }
  return rows;
}
