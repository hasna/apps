import type {
  AgentTarget,
  CommandTarget,
  Loop,
  LoopRun,
  LoopTarget,
  ScheduleSpec,
  WorkflowSpec,
  WorkflowStep,
} from "../types.js";
import { validateAgentTarget } from "./agent-adapter.js";
import { MigrationImportInvalidError } from "./errors.js";
import { normalizeLoopLabels } from "./labels.js";
import { validateLoopMachineRef } from "./machines.js";
import {
  validImportOperationId,
  type ImportContractInput,
  type ImportLoopRow,
  type ImportRunRow,
  type ImportWorkflowRow,
} from "./import-contract.js";
import { isExpiresAfterRuns, isLeaseMs, isLoopStatus, isMaxAttempts } from "./loop-status.js";
import { parseCron } from "./recurrence.js";
import { normalizeGoalSpec, workflowExecutionOrder } from "./workflow-spec.js";

const WORKFLOW_STATUSES = new Set(["active", "archived"]);
const RUN_STATUSES = new Set(["running", "succeeded", "failed", "timed_out", "abandoned", "skipped"]);
const CATCH_UP_POLICIES = new Set(["none", "latest", "all"]);
const OVERLAP_POLICIES = new Set(["skip", "allow"]);

export interface ValidatedImportRequest extends ImportContractInput {
  workflows: ImportWorkflowRow[];
  loops: ImportLoopRow[];
  runs: ImportRunRow[];
}

function invalid(): never {
  throw new MigrationImportInvalidError();
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const keys = new Set(allowed);
  if (Object.keys(value).some((key) => !keys.has(key))) invalid();
}

function nonEmptyString(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") invalid();
  return value;
}

function optionalString(value: unknown, allowEmpty = false): void {
  if (value === undefined) return;
  if (typeof value !== "string" || (!allowEmpty && value.trim() === "")) invalid();
}

function timestamp(value: unknown): string {
  const text = nonEmptyString(value);
  if (!Number.isFinite(Date.parse(text))) invalid();
  return text;
}

function optionalTimestamp(value: unknown): void {
  if (value !== undefined) timestamp(value);
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) invalid();
  return Number(value);
}

function nonNegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid();
  return Number(value);
}

function optionalPositiveInteger(value: unknown): void {
  if (value !== undefined) positiveInteger(value);
}

function optionalNonNegativeInteger(value: unknown): void {
  if (value !== undefined) nonNegativeInteger(value);
}

function optionalTimeout(value: unknown): void {
  if (value !== undefined && value !== null) positiveInteger(value);
}

function optionalBoolean(value: unknown): void {
  if (value !== undefined && typeof value !== "boolean") invalid();
}

function stringArray(value: unknown, optional = true): string[] | undefined {
  if (value === undefined && optional) return undefined;
  if (!Array.isArray(value)) invalid();
  const rows = value as unknown[];
  if (rows.some((entry) => typeof entry !== "string" || entry.trim() === "")) invalid();
  return rows as string[];
}

function stringRecord(value: unknown): void {
  if (value === undefined) return;
  const row = record(value);
  if (Object.entries(row).some(([key, entry]) => key.trim() === "" || typeof entry !== "string")) invalid();
}

function account(value: unknown): void {
  if (value === undefined) return;
  const row = record(value);
  onlyKeys(row, ["profile", "tool"]);
  nonEmptyString(row.profile);
  optionalString(row.tool);
}

function preflight(value: unknown): void {
  if (value === undefined) return;
  const row = record(value);
  onlyKeys(row, ["beforeRun"]);
  optionalBoolean(row.beforeRun);
}

function goal(value: unknown): void {
  if (value === undefined) return;
  const row = record(value);
  onlyKeys(row, ["objective", "tokenBudget", "maxTurns", "maxTokens", "model", "autoExecute"]);
  optionalString(row.model);
  normalizeGoalSpec(row);
}

function allowlist(value: unknown): void {
  if (value === undefined) return;
  const row = record(value);
  onlyKeys(row, ["tools", "commands", "enforcement", "safetyReason"]);
  stringArray(row.tools);
  stringArray(row.commands);
  if (row.enforcement !== undefined && row.enforcement !== "metadata_only") invalid();
  optionalString(row.safetyReason);
}

function worktree(value: unknown): void {
  if (value === undefined) return;
  const row = record(value);
  onlyKeys(row, ["mode", "enabled", "originalCwd", "cwd", "repoRoot", "root", "path", "branch", "reason"]);
  if (!["auto", "required", "off", "main"].includes(nonEmptyString(row.mode))) invalid();
  if (typeof row.enabled !== "boolean") invalid();
  nonEmptyString(row.originalCwd);
  nonEmptyString(row.cwd);
  for (const key of ["repoRoot", "root", "path", "branch", "reason"] as const) optionalString(row[key]);
}

function routing(value: unknown): void {
  if (value === undefined) return;
  const row = record(value);
  onlyKeys(row, ["projectPath", "projectGroup", "taskId", "eventId", "eventType", "eventSource", "role"]);
  for (const key of ["projectPath", "projectGroup", "taskId", "eventId", "eventType", "eventSource"] as const) {
    optionalString(row[key]);
  }
  if (row.role !== undefined && !["triage", "planner", "worker", "verifier"].includes(String(row.role))) invalid();
}

function promptSource(value: unknown): void {
  if (value === undefined) return;
  const row = record(value);
  onlyKeys(row, ["type", "path"]);
  if (row.type !== "file") invalid();
  nonEmptyString(row.path);
}

function commandTarget(row: Record<string, unknown>): CommandTarget {
  onlyKeys(row, ["type", "command", "args", "cwd", "shell", "env", "timeoutMs", "idleTimeoutMs", "account", "preflight"]);
  const command = nonEmptyString(row.command);
  if (row.shell !== undefined && typeof row.shell !== "boolean") invalid();
  if (row.shell !== true && /\s/.test(command.trim())) invalid();
  stringArray(row.args);
  optionalString(row.cwd);
  stringRecord(row.env);
  optionalTimeout(row.timeoutMs);
  optionalPositiveInteger(row.idleTimeoutMs);
  account(row.account);
  preflight(row.preflight);
  return row as unknown as CommandTarget;
}

function agentTarget(row: Record<string, unknown>): AgentTarget {
  onlyKeys(row, [
    "type", "provider", "prompt", "promptSource", "cwd", "model", "variant", "agent", "authProfile", "env",
    "extraArgs", "addDirs", "timeoutMs", "idleTimeoutMs", "configIsolation", "permissionMode", "sandbox",
    "manualBreakGlass", "automated", "allowlist", "worktree", "routing", "account", "preflight",
  ]);
  for (const key of ["prompt", "cwd", "model", "variant", "agent", "authProfile", "configIsolation", "permissionMode", "sandbox"] as const) {
    if (key === "prompt") nonEmptyString(row[key]);
    else optionalString(row[key]);
  }
  promptSource(row.promptSource);
  stringRecord(row.env);
  stringArray(row.extraArgs);
  stringArray(row.addDirs);
  optionalTimeout(row.timeoutMs);
  optionalPositiveInteger(row.idleTimeoutMs);
  optionalBoolean(row.manualBreakGlass);
  optionalBoolean(row.automated);
  allowlist(row.allowlist);
  worktree(row.worktree);
  routing(row.routing);
  account(row.account);
  preflight(row.preflight);
  validateAgentTarget(row);
  return row as unknown as AgentTarget;
}

function executableTarget(value: unknown): CommandTarget | AgentTarget {
  const row = record(value);
  if (row.type === "command") return commandTarget(row);
  if (row.type === "agent") return agentTarget(row);
  invalid();
}

function loopTarget(value: unknown): LoopTarget {
  const row = record(value);
  if (row.type === "command" || row.type === "agent") return executableTarget(row);
  if (row.type !== "workflow") invalid();
  onlyKeys(row, ["type", "workflowId", "input", "timeoutMs", "preflight"]);
  nonEmptyString(row.workflowId);
  stringRecord(row.input);
  optionalTimeout(row.timeoutMs);
  preflight(row.preflight);
  return row as unknown as LoopTarget;
}

function schedule(value: unknown): ScheduleSpec {
  const row = record(value);
  if (row.type === "once") {
    onlyKeys(row, ["type", "at"]);
    timestamp(row.at);
  } else if (row.type === "interval") {
    onlyKeys(row, ["type", "everyMs", "anchor"]);
    positiveInteger(row.everyMs);
    if (row.anchor !== undefined && row.anchor !== "fixed_rate" && row.anchor !== "fixed_delay") invalid();
  } else if (row.type === "cron") {
    onlyKeys(row, ["type", "expression"]);
    parseCron(nonEmptyString(row.expression));
  } else if (row.type === "dynamic") {
    onlyKeys(row, ["type", "minIntervalMs"]);
    optionalPositiveInteger(row.minIntervalMs);
  } else {
    invalid();
  }
  return row as unknown as ScheduleSpec;
}

function workflowStep(value: unknown): WorkflowStep {
  const row = record(value);
  onlyKeys(row, ["id", "name", "description", "target", "goal", "dependsOn", "continueOnFailure", "timeoutMs", "account"]);
  nonEmptyString(row.id);
  optionalString(row.name);
  optionalString(row.description, true);
  const target = executableTarget(row.target);
  goal(row.goal);
  const dependsOn = stringArray(row.dependsOn) ?? [];
  optionalBoolean(row.continueOnFailure);
  optionalTimeout(row.timeoutMs);
  account(row.account);
  return { ...row, target, dependsOn } as unknown as WorkflowStep;
}

function workflow(value: unknown): WorkflowSpec {
  const row = record(value);
  onlyKeys(row, ["id", "name", "description", "version", "status", "goal", "steps", "createdAt", "updatedAt"]);
  nonEmptyString(row.id);
  nonEmptyString(row.name);
  optionalString(row.description, true);
  positiveInteger(row.version);
  if (typeof row.status !== "string" || !WORKFLOW_STATUSES.has(row.status)) invalid();
  goal(row.goal);
  if (!Array.isArray(row.steps) || row.steps.length === 0) invalid();
  const steps = row.steps.map(workflowStep);
  if (new Set(steps.map((step) => step.id)).size !== steps.length) invalid();
  workflowExecutionOrder({ steps });
  timestamp(row.createdAt);
  timestamp(row.updatedAt);
  return { ...row, steps } as unknown as WorkflowSpec;
}

function machine(value: unknown): void {
  if (value === undefined) return;
  const row = record(value);
  onlyKeys(row, ["id", "requestedId", "route", "local", "confidence", "workspacePath", "resolvedAt", "packageVersion", "warnings"]);
  validateLoopMachineRef(row);
  optionalString(row.requestedId);
  if (row.route !== undefined && !["local", "lan", "tailscale", "ssh", "unknown"].includes(String(row.route))) invalid();
  optionalBoolean(row.local);
  if (row.confidence !== undefined && !["exact", "high", "medium", "low", "none"].includes(String(row.confidence))) invalid();
  optionalString(row.workspacePath);
  optionalTimestamp(row.resolvedAt);
  optionalString(row.packageVersion);
  stringArray(row.warnings);
}

function loop(value: unknown): Loop {
  const row = record(value);
  onlyKeys(row, [
    "id", "name", "description", "labels", "status", "archivedAt", "archivedFromStatus", "schedule", "target",
    "goal", "machine", "nextRunAt", "retryScheduledFor", "catchUp", "catchUpLimit", "overlap", "maxAttempts",
    "retryDelayMs", "leaseMs", "expiresAt", "expiresAfterRuns", "bundleName", "bundlePinnedVersion",
    "createdAt", "updatedAt",
  ]);
  nonEmptyString(row.id);
  nonEmptyString(row.name);
  optionalString(row.description, true);
  if (row.labels !== undefined) {
    if (!Array.isArray(row.labels)) invalid();
    normalizeLoopLabels(row.labels as string[]);
  }
  if (!isLoopStatus(row.status)) invalid();
  optionalTimestamp(row.archivedAt);
  if (row.archivedFromStatus !== undefined && !isLoopStatus(row.archivedFromStatus)) invalid();
  const parsedSchedule = schedule(row.schedule);
  const target = loopTarget(row.target);
  goal(row.goal);
  machine(row.machine);
  optionalTimestamp(row.nextRunAt);
  optionalTimestamp(row.retryScheduledFor);
  if (typeof row.catchUp !== "string" || !CATCH_UP_POLICIES.has(row.catchUp)) invalid();
  positiveInteger(row.catchUpLimit);
  if (typeof row.overlap !== "string" || !OVERLAP_POLICIES.has(row.overlap)) invalid();
  if (!isMaxAttempts(row.maxAttempts)) invalid();
  nonNegativeInteger(row.retryDelayMs);
  if (!isLeaseMs(row.leaseMs)) invalid();
  optionalTimestamp(row.expiresAt);
  if (row.expiresAfterRuns !== undefined && !isExpiresAfterRuns(row.expiresAfterRuns)) invalid();
  optionalString(row.bundleName);
  optionalPositiveInteger(row.bundlePinnedVersion);
  timestamp(row.createdAt);
  timestamp(row.updatedAt);
  return { ...row, schedule: parsedSchedule, target } as unknown as Loop;
}

function run(value: unknown): LoopRun {
  const row = record(value);
  onlyKeys(row, [
    "id", "loopId", "loopName", "scheduledFor", "attempt", "status", "startedAt", "finishedAt", "claimedBy",
    "leaseExpiresAt", "pid", "pgid", "processStartedAt", "exitCode", "durationMs", "stdout", "stderr", "error",
    "goalRunId", "createdAt", "updatedAt",
  ]);
  nonEmptyString(row.id);
  nonEmptyString(row.loopId);
  nonEmptyString(row.loopName);
  timestamp(row.scheduledFor);
  positiveInteger(row.attempt);
  if (typeof row.status !== "string" || !RUN_STATUSES.has(row.status)) invalid();
  optionalTimestamp(row.startedAt);
  optionalTimestamp(row.finishedAt);
  optionalString(row.claimedBy);
  optionalTimestamp(row.leaseExpiresAt);
  optionalPositiveInteger(row.pid);
  optionalPositiveInteger(row.pgid);
  optionalTimestamp(row.processStartedAt);
  if (row.exitCode !== undefined && !Number.isSafeInteger(row.exitCode)) invalid();
  optionalNonNegativeInteger(row.durationMs);
  optionalString(row.stdout, true);
  optionalString(row.stderr, true);
  optionalString(row.error, true);
  optionalString(row.goalRunId);
  timestamp(row.createdAt);
  timestamp(row.updatedAt);
  if (row.status === "running" && row.finishedAt !== undefined) invalid();
  if (row.status !== "running" && row.finishedAt === undefined) invalid();
  return row as unknown as LoopRun;
}

export function validateImportRequest(value: unknown): ValidatedImportRequest {
  try {
    const body = record(value);
    onlyKeys(body, [
      "operationId", "workflows", "loops", "runs", "replace", "preserveLoopScheduling", "preserveWorkflowActivation",
    ]);
    if (body.operationId !== undefined && !validImportOperationId(body.operationId)) invalid();
    optionalBoolean(body.replace);
    optionalBoolean(body.preserveLoopScheduling);
    optionalBoolean(body.preserveWorkflowActivation);
    if (body.workflows !== undefined && !Array.isArray(body.workflows)) invalid();
    if (body.loops !== undefined && !Array.isArray(body.loops)) invalid();
    if (body.runs !== undefined && !Array.isArray(body.runs)) invalid();
    return {
      operationId: body.operationId as string | undefined,
      workflows: (body.workflows ?? []).map(workflow),
      loops: (body.loops ?? []).map(loop),
      runs: (body.runs ?? []).map(run),
      replace: body.replace as boolean | undefined,
      preserveLoopScheduling: body.preserveLoopScheduling as boolean | undefined,
      preserveWorkflowActivation: body.preserveWorkflowActivation as boolean | undefined,
    };
  } catch (error) {
    if (error instanceof MigrationImportInvalidError) throw error;
    throw new MigrationImportInvalidError();
  }
}
