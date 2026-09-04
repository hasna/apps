import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type {
  CatchUpPolicy,
  CreateLoopInput,
  CreateLoopRevisionInput,
  CreateWorkflowInvocationInput,
  CreateWorkflowInput,
  Goal,
  GoalAutoExecute,
  GoalPlanNode,
  GoalPlanNodeStatus,
  GoalRun,
  GoalSpec,
  GoalStatus,
  Loop,
  LoopBundleSummary,
  LoopRevision,
  LoopRun,
  LoopStatus,
  LoopTarget,
  RecoveredLeaseRunSnapshotEntry,
  RunReceipt,
  RunReceiptMachine,
  RunStatus,
  TimeoutMs,
  StoredWorkflowEvent,
  WriteRunReceiptInput,
  WorkflowInvocation,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowSpec,
  WorkflowStepRun,
  WorkflowStepRunStatus,
  WorkflowWorkItem,
  WorkflowWorkItemStatus,
  UpsertWorkflowWorkItemInput,
} from "../types.js";
import {
  AmbiguousNameError,
  BundleNameTakenError,
  DuplicateWorkflowEventError,
  LegacyWorkflowRunProvenanceError,
  LoopArchivedError,
  LoopMutationConflictError,
  LoopNotFoundError,
  LoopVersionNotFoundError,
  RunFinalizationConflictError,
  ValidationError,
  WorkflowRunDefinitionConflictError,
  WorkflowRunHasLiveStepsError,
  WorkflowRunNotRunningError,
} from "./errors.js";
import { genId, nowIso } from "./ids.js";
import { dbPath } from "./paths.js";
import { processStartTimeMs, sameProcessStart, verifiedProcessStart, START_TIME_TOLERANCE_MS } from "./process-identity.js";
import { scrubSecrets, scrubSecretsDeep } from "./redact.js";
import { initialNextRun } from "./recurrence.js";
import { assertGoalTransition, rollupSummary, updateReadyFlags } from "./goal/status.js";
import { GOAL_TERMINAL } from "./goal/types.js";
import { normalizeCreateWorkflowInput } from "./workflow-spec.js";
import {
  initialAgentSessionContractEvents,
  type InitialAgentSessionContractEvent,
  workflowDefinitionHash,
} from "./workflow-provenance.js";
import {
  commitWorkflowRunManifest,
  discardWorkflowRunManifest,
  stageWorkflowRunManifest,
} from "./run-artifacts.js";
import { normalizeRunReceipt } from "./run-receipts.js";
import { normalizeLoopLabels } from "./labels.js";
import { assertExpiresAfterRuns, assertLeaseMs, assertLoopStatus, assertMaxAttempts } from "./loop-status.js";
import { normalizeRunCompletion } from "./run-completion.js";
import { runLocalCommand, todosCliArgs, todosMutationSummary } from "./route/todos-cli.js";
import {
  DEFAULT_LOOP_MUTATION_LOOKUP_CAPS,
  isPrivateOperationEventType,
  loopMutationAdmissionReceipt,
  loopMutationTerminalReceipt,
  normalizeLoopMutationEnvelope,
  privateOperationEventsForWorkflowRun,
  type LoopMutationEnvelope,
  type LoopMutationLookupCaps,
  type LoopMutationResult,
  type OperationAuthorityBinding,
} from "./operation-contract.js";

interface DaemonLeaseFence {
  daemonLeaseId?: string;
  now?: Date;
  claimToken?: string;
  recoveredRun?: RecoveredLeaseRunSnapshotEntry;
}

export interface WorkflowRecoveryContext {
  mode?: "internal" | "operator" | "runner";
  now?: Date;
  loopRunId?: string;
  claimedBy?: string;
  claimToken?: string;
}

export type LoopSchedulingState = Pick<Loop, "status" | "nextRunAt" | "retryScheduledFor">;

export interface CircuitBreakerTransitionResult {
  loop: Loop;
  marker: LoopRun;
}

const DEFAULT_RECOVERY_BATCH_LIMIT = 100;
const DEFAULT_RECOVERY_SCAN_MULTIPLIER = 5;
export const LIVE_EXPIRED_RUN_GRACE_MS = 60_000;
/**
 * Ceiling on CONSECUTIVE lease-recovery deferrals for a single run. Past it the
 * run is abandoned regardless of how alive its process still looks.
 *
 * A grace that cannot expire is not a grace. Without this ceiling a run whose
 * process merely *looks* alive is re-deferred every
 * {@link LIVE_EXPIRED_RUN_GRACE_MS} forever: never abandoned, never advanced,
 * and blocking everything queued behind it (station01, 2026-07-31 — a wall of
 * codewith "Loop run deferred" toasts once a minute and a stalled publish).
 *
 * A run only reaches recovery when its lease has ALREADY expired, which means
 * the runner stopped renewing it — healthy work renews and never enters this
 * path at all. So the ceiling costs a genuinely-live run nothing, and bounds
 * total grace at MAX x GRACE (10 min), after which a wedged or
 * recycled-pid run is released instead of wedging the queue.
 */
export const MAX_LIVE_EXPIRED_RUN_DEFERRALS = 10;
/**
 * Highest schema version this binary understands. Bump alongside every new
 * numbered migration so older binaries refuse to open newer databases instead
 * of silently misreading them (checked against PRAGMA user_version).
 */
const SCHEMA_USER_VERSION = 8;
/**
 * The database-carried compatibility floor this binary writes into
 * `schema_compat.min_compatible_user_version`: the LOWEST
 * `SCHEMA_USER_VERSION` a binary may have and still safely open a database
 * migrated to this binary's schema. Raise it ONLY when a migration is
 * breaking for older readers (semantic changes older binaries would misread —
 * e.g. 0007's run claim tokens, which alter claim-concurrency correctness).
 * Purely additive migrations (new nullable columns, new tables, new indexes:
 * 0008 route_scope, 0009 run receipts, 0010 work-item machine_id) must NOT
 * raise it — that is exactly what lets an older binary keep working during a
 * rollout instead of bricking the CLI fleet (the 2026-07-07 schema-8 lockout).
 */
const BREAKING_SCHEMA_FLOOR = 7;
const TERMINAL_RUN_STATUSES = ["succeeded", "failed", "timed_out", "abandoned", "skipped"] as const;
const PRUNE_BATCH_SIZE = 400;
export const GENERATED_ROUTE_TEMPLATE_IDS = new Set(["todos-task-worker-verifier", "task-lifecycle", "event-worker-verifier"]);
export const GENERATED_ROUTE_KEYS = new Set(["todos-task", "generic-event"]);
const TASK_LIFECYCLE_TEMPLATE_ID = "task-lifecycle";

export function isGeneratedRouteTemplate(routeKey: string, templateId: string): boolean {
  return routeKey === "todos-task"
    ? templateId === "todos-task-worker-verifier" || templateId === TASK_LIFECYCLE_TEMPLATE_ID
    : routeKey === "generic-event" && templateId === "event-worker-verifier";
}

export interface LoopRow {
  id: string;
  name: string;
  description: string | null;
  labels_json: string | null;
  status: string;
  archived_at: string | null;
  archived_from_status: string | null;
  schedule_json: string;
  target_json: string;
  goal_json: string | null;
  machine_json: string | null;
  next_run_at: string | null;
  retry_scheduled_for: string | null;
  catch_up: string;
  catch_up_limit: number;
  overlap: string;
  max_attempts: number;
  retry_delay_ms: number;
  lease_ms: number;
  expires_at: string | null;
  expires_after_runs: number | null;
  bundle_name: string | null;
  bundle_pinned_version: number | null;
  created_at: string;
  updated_at: string;
}

/** A row of the append-only `loop_revisions` ledger (sqlite mirror of pg 0016). */
export interface LoopRevisionRow {
  loop_id: string;
  version: number;
  bundle_name: string;
  bundle_digest: string;
  archive_sha256: string;
  archive_bytes: number;
  storage_kind: string;
  storage_key: string | null;
  manifest_json: string;
  loop_json: string;
  carries_prompt: number;
  author: string;
  source_station: string | null;
  source_agent: string | null;
  reason: string | null;
  rolled_back_from: number | null;
  created_at: string;
}

export interface RunRow {
  id: string;
  loop_id: string;
  loop_name: string;
  scheduled_for: string;
  attempt: number;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  claimed_by: string | null;
  claim_token: string | null;
  lease_expires_at: string | null;
  pid: number | null;
  pgid: number | null;
  process_started_at: string | null;
  /** Nullable for rows read before migration 0014 backfills the column. */
  defer_count: number | null;
  exit_code: number | null;
  duration_ms: number | null;
  stdout: string | null;
  stderr: string | null;
  error: string | null;
  goal_run_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunReceiptRow {
  loop_id: string;
  run_id: string;
  machine_json: string;
  repo: string;
  task_ids_json: string;
  knowledge_ids_json: string;
  digest_id: string;
  started_at: string | null;
  finished_at: string | null;
  status: string;
  exit_code: number | null;
  summary_json: string;
  evidence_paths_json: string;
  bundle_json: string | null;
  created_at: string;
  updated_at: string;
}

interface LatestRunSummaryRow {
  loop_id: string;
  id: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface WorkflowRow {
  id: string;
  name: string;
  description: string | null;
  version: number;
  status: string;
  goal_json: string | null;
  steps_json: string;
  created_at: string;
  updated_at: string;
}

export interface WorkflowRunRow {
  id: string;
  workflow_id: string;
  workflow_name: string;
  loop_id: string | null;
  loop_run_id: string | null;
  invocation_id: string | null;
  work_item_id: string | null;
  scheduled_for: string | null;
  idempotency_key: string | null;
  workflow_definition_hash: string | null;
  manifest_path: string | null;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  error: string | null;
  goal_run_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkflowInvocationRow {
  id: string;
  workflow_id: string | null;
  template_id: string | null;
  source_kind: string;
  source_id: string | null;
  source_dedupe_key: string | null;
  source_json: string;
  subject_kind: string;
  subject_id: string | null;
  subject_path: string | null;
  subject_url: string | null;
  subject_json: string;
  intent: string;
  scope_json: string | null;
  output_policy_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkflowWorkItemRow {
  id: string;
  route_key: string;
  idempotency_key: string;
  invocation_id: string;
  source_type: string;
  source_ref: string;
  subject_ref: string;
  project_key: string | null;
  project_group: string | null;
  machine_id: string | null;
  route_scope: string | null;
  priority: number;
  status: string;
  attempts: number;
  /** Nullable for rows read before migration 0011 backfills the column. */
  gate_deaths: number | null;
  next_attempt_at: string | null;
  lease_expires_at: string | null;
  workflow_id: string | null;
  loop_id: string | null;
  workflow_run_id: string | null;
  last_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkflowStepRunRow {
  id: string;
  workflow_run_id: string;
  step_id: string;
  sequence: number;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  exit_code: number | null;
  pid: number | null;
  /** Nullable for rows written before migration 0014 added the fingerprint. */
  process_started_at: string | null;
  duration_ms: number | null;
  stdout: string | null;
  stderr: string | null;
  error: string | null;
  account_profile: string | null;
  account_tool: string | null;
  goal_run_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkflowEventRow {
  id: string;
  workflow_run_id: string;
  sequence: number;
  event_type: string;
  step_id: string | null;
  payload_json: string | null;
  created_at: string;
}

export interface GoalRow {
  id: string;
  plan_id: string;
  objective: string;
  status: string;
  token_budget: number | null;
  tokens_used: number;
  time_used_seconds: number;
  auto_execute: string;
  max_tokens: number | null;
  source_type: string | null;
  source_id: string | null;
  loop_id: string | null;
  loop_run_id: string | null;
  workflow_id: string | null;
  workflow_run_id: string | null;
  workflow_step_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface GoalPlanNodeRow {
  id: string;
  goal_id: string;
  plan_id: string;
  key: string;
  sequence: number;
  priority: number;
  objective: string;
  status: string;
  ready: number;
  token_budget: number | null;
  tokens_used: number;
  time_used_seconds: number;
  depends_on_json: string;
  created_at: string;
  updated_at: string;
}

export interface GoalRunRow {
  id: string;
  goal_id: string;
  plan_id: string;
  loop_id: string | null;
  loop_run_id: string | null;
  workflow_id: string | null;
  workflow_run_id: string | null;
  workflow_step_id: string | null;
  turn: number;
  phase: string;
  status: string;
  node_key: string | null;
  tokens_used: number;
  evidence_json: string | null;
  raw_response_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface DaemonLease {
  id: string;
  pid: number;
  hostname: string;
  heartbeatAt: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface LeaseRow {
  id: string;
  pid: number;
  hostname: string;
  heartbeat_at: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export function rowToLoop(row: LoopRow): Loop {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    labels: row.labels_json ? normalizeLoopLabels(JSON.parse(row.labels_json) as string[]) : [],
    status: row.status as LoopStatus,
    archivedAt: row.archived_at ?? undefined,
    archivedFromStatus: row.archived_from_status ? (row.archived_from_status as LoopStatus) : undefined,
    schedule: JSON.parse(row.schedule_json) as Loop["schedule"],
    target: JSON.parse(row.target_json) as Loop["target"],
    goal: row.goal_json ? (JSON.parse(row.goal_json) as Loop["goal"]) : undefined,
    machine: row.machine_json ? (JSON.parse(row.machine_json) as Loop["machine"]) : undefined,
    nextRunAt: row.next_run_at ?? undefined,
    retryScheduledFor: row.retry_scheduled_for ?? undefined,
    catchUp: row.catch_up as Loop["catchUp"],
    catchUpLimit: row.catch_up_limit,
    overlap: row.overlap as Loop["overlap"],
    maxAttempts: row.max_attempts,
    retryDelayMs: row.retry_delay_ms,
    leaseMs: row.lease_ms,
    expiresAt: row.expires_at ?? undefined,
    expiresAfterRuns: row.expires_after_runs ?? undefined,
    bundleName: row.bundle_name ?? undefined,
    bundlePinnedVersion: row.bundle_pinned_version ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToLoopRevision(row: LoopRevisionRow): LoopRevision {
  return {
    loopId: row.loop_id,
    version: row.version,
    bundleName: row.bundle_name,
    bundleDigest: row.bundle_digest,
    archiveSha256: row.archive_sha256,
    archiveBytes: row.archive_bytes,
    storageKind: row.storage_kind === "s3" ? "s3" : "db",
    storageKey: row.storage_key ?? undefined,
    manifest: JSON.parse(row.manifest_json) as Record<string, unknown>,
    loopJson: JSON.parse(row.loop_json) as Record<string, unknown>,
    carriesPrompt: row.carries_prompt !== 0,
    author: row.author,
    sourceStation: row.source_station ?? undefined,
    sourceAgent: row.source_agent ?? undefined,
    reason: row.reason ?? undefined,
    rolledBackFrom: row.rolled_back_from ?? undefined,
    createdAt: row.created_at,
  };
}

export function rowToRun(row: RunRow): LoopRun {
  return {
    id: row.id,
    loopId: row.loop_id,
    loopName: row.loop_name,
    scheduledFor: row.scheduled_for,
    attempt: row.attempt,
    status: row.status as RunStatus,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    claimedBy: row.claimed_by ?? undefined,
    leaseExpiresAt: row.lease_expires_at ?? undefined,
    pid: row.pid ?? undefined,
    pgid: row.pgid ?? undefined,
    processStartedAt: row.process_started_at ?? undefined,
    exitCode: row.exit_code ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    stdout: row.stdout ?? undefined,
    stderr: row.stderr ?? undefined,
    error: row.error ?? undefined,
    goalRunId: row.goal_run_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToRunReceipt(row: RunReceiptRow): RunReceipt {
  return {
    loop_id: row.loop_id,
    run_id: row.run_id,
    machine: JSON.parse(row.machine_json) as RunReceiptMachine,
    repo: row.repo,
    task_ids: JSON.parse(row.task_ids_json) as string[],
    knowledge_ids: JSON.parse(row.knowledge_ids_json) as string[],
    digest_id: row.digest_id,
    started_at: row.started_at,
    finished_at: row.finished_at,
    status: row.status,
    exit_code: row.exit_code,
    summary: JSON.parse(row.summary_json) as RunReceipt["summary"],
    evidence_paths: JSON.parse(row.evidence_paths_json) as string[],
    bundle: row.bundle_json ? (JSON.parse(row.bundle_json) as RunReceipt["bundle"]) : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function latestRunTime(row: LatestRunSummaryRow): string {
  return row.finished_at ?? row.started_at ?? row.created_at;
}

export function rowToWorkflow(row: WorkflowRow): WorkflowSpec {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    version: row.version,
    status: row.status as WorkflowSpec["status"],
    goal: row.goal_json ? (JSON.parse(row.goal_json) as WorkflowSpec["goal"]) : undefined,
    steps: JSON.parse(row.steps_json) as WorkflowSpec["steps"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToWorkflowRun(row: WorkflowRunRow): WorkflowRun {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    workflowName: row.workflow_name,
    loopId: row.loop_id ?? undefined,
    loopRunId: row.loop_run_id ?? undefined,
    invocationId: row.invocation_id ?? undefined,
    workItemId: row.work_item_id ?? undefined,
    scheduledFor: row.scheduled_for ?? undefined,
    idempotencyKey: row.idempotency_key ?? undefined,
    manifestPath: row.manifest_path ?? undefined,
    status: row.status as WorkflowRunStatus,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    error: row.error ?? undefined,
    goalRunId: row.goal_run_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToWorkflowInvocation(row: WorkflowInvocationRow): WorkflowInvocation {
  return {
    id: row.id,
    workflowId: row.workflow_id ?? undefined,
    templateId: row.template_id ?? undefined,
    sourceRef: JSON.parse(row.source_json) as WorkflowInvocation["sourceRef"],
    subjectRef: JSON.parse(row.subject_json) as WorkflowInvocation["subjectRef"],
    intent: row.intent as WorkflowInvocation["intent"],
    scope: row.scope_json ? (JSON.parse(row.scope_json) as WorkflowInvocation["scope"]) : undefined,
    outputPolicy: row.output_policy_json ? (JSON.parse(row.output_policy_json) as WorkflowInvocation["outputPolicy"]) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToWorkflowWorkItem(row: WorkflowWorkItemRow): WorkflowWorkItem {
  return {
    id: row.id,
    routeKey: row.route_key,
    idempotencyKey: row.idempotency_key,
    invocationId: row.invocation_id,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    subjectRef: row.subject_ref,
    projectKey: row.project_key ?? undefined,
    projectGroup: row.project_group ?? undefined,
    machineId: row.machine_id ?? undefined,
    routeScope: row.route_scope ?? undefined,
    priority: row.priority,
    status: row.status as WorkflowWorkItemStatus,
    attempts: row.attempts,
    gateDeaths: row.gate_deaths ?? 0,
    nextAttemptAt: row.next_attempt_at ?? undefined,
    leaseExpiresAt: row.lease_expires_at ?? undefined,
    workflowId: row.workflow_id ?? undefined,
    loopId: row.loop_id ?? undefined,
    workflowRunId: row.workflow_run_id ?? undefined,
    lastReason: row.last_reason ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToWorkflowStepRun(row: WorkflowStepRunRow): WorkflowStepRun {
  return {
    id: row.id,
    workflowRunId: row.workflow_run_id,
    stepId: row.step_id,
    sequence: row.sequence,
    status: row.status as WorkflowStepRunStatus,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    exitCode: row.exit_code ?? undefined,
    pid: row.pid ?? undefined,
    processStartedAt: row.process_started_at ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    stdout: row.stdout ?? undefined,
    stderr: row.stderr ?? undefined,
    error: row.error ?? undefined,
    accountProfile: row.account_profile ?? undefined,
    accountTool: row.account_tool ?? undefined,
    goalRunId: row.goal_run_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToGoal(row: GoalRow): Goal {
  return {
    goalId: row.id,
    planId: row.plan_id,
    objective: row.objective,
    status: row.status as GoalStatus,
    tokenBudget: row.token_budget ?? undefined,
    tokensUsed: row.tokens_used,
    timeUsedSeconds: row.time_used_seconds,
    autoExecute: row.auto_execute as GoalAutoExecute,
    maxTokens: row.max_tokens ?? undefined,
    sourceType: row.source_type ?? undefined,
    sourceId: row.source_id ?? undefined,
    loopId: row.loop_id ?? undefined,
    loopRunId: row.loop_run_id ?? undefined,
    workflowId: row.workflow_id ?? undefined,
    workflowRunId: row.workflow_run_id ?? undefined,
    workflowStepId: row.workflow_step_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToGoalPlanNode(row: GoalPlanNodeRow): GoalPlanNode {
  return {
    nodeId: row.id,
    planId: row.plan_id,
    key: row.key,
    sequence: row.sequence,
    priority: row.priority,
    objective: row.objective,
    status: row.status as GoalPlanNodeStatus,
    ready: row.ready === 1,
    tokenBudget: row.token_budget ?? undefined,
    tokensUsed: row.tokens_used,
    timeUsedSeconds: row.time_used_seconds,
    dependsOn: JSON.parse(row.depends_on_json) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToGoalRun(row: GoalRunRow): GoalRun {
  return {
    runId: row.id,
    goalId: row.goal_id,
    planId: row.plan_id,
    loopId: row.loop_id ?? undefined,
    loopRunId: row.loop_run_id ?? undefined,
    workflowId: row.workflow_id ?? undefined,
    workflowRunId: row.workflow_run_id ?? undefined,
    workflowStepId: row.workflow_step_id ?? undefined,
    turn: row.turn,
    phase: row.phase as GoalRun["phase"],
    status: row.status as GoalRun["status"],
    nodeKey: row.node_key ?? undefined,
    tokensUsed: row.tokens_used,
    evidence: row.evidence_json ? (JSON.parse(row.evidence_json) as Record<string, unknown>) : undefined,
    rawResponse: row.raw_response_json ? (JSON.parse(row.raw_response_json) as unknown) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToWorkflowEvent(row: WorkflowEventRow): StoredWorkflowEvent {
  return {
    id: row.id,
    workflowRunId: row.workflow_run_id,
    sequence: row.sequence,
    eventType: row.event_type,
    stepId: row.step_id ?? undefined,
    payload: row.payload_json ? (JSON.parse(row.payload_json) as Record<string, unknown>) : undefined,
    createdAt: row.created_at,
  };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the process recorded for a run is still the same live process. A
 * bare pid check is not enough — pids are recycled (reboot, pid wraparound) —
 * so the recorded `process_started_at` fingerprint must also match the pid's
 * actual start time. Rows without a fingerprint (pre-migration-0006) stay
 * lenient via {@link sameProcessStart}, matching the daemon reaper's
 * fail-closed skip for the same rows.
 */
function isRecordedProcessAlive(pid: number | null | undefined, processStartedAt: string | null | undefined): boolean {
  if (!pid || !isProcessAlive(pid)) return false;
  return sameProcessStart(processStartedAt ?? undefined, processStartTimeMs(pid));
}

function isoProcessStart(pid: number): string | undefined {
  const startedMs = processStartTimeMs(pid);
  return startedMs === undefined ? undefined : new Date(startedMs).toISOString();
}

/**
 * Whether a workflow step's recorded pid is still the step's own process.
 *
 * Two paths, because the answer is only as strong as the evidence on the row:
 *
 * - **Fingerprinted** (migration 0014 onward): `processStartedAt` holds the
 *   child's real start time, so identity is a TWO-SIDED match via
 *   {@link verifiedProcessStart} — the same strict comparison
 *   `isRecordedProcessAlive` uses for runs, and it fails closed. This is what
 *   rejects a recycled pid: the OS handing that number to an unrelated process
 *   yields a start time that does not match, in either direction.
 *
 * - **Legacy** (rows written before 0014, no fingerprint): fall back to the
 *   step's `started_at` as a lower bound. This is a guess, not an identity
 *   check — it rejects a pid older than the step but cannot reject a newer
 *   one — so it stays lenient on unresolvable data rather than killing live
 *   work mid-upgrade. Leniency here is safe ONLY because
 *   {@link MAX_LIVE_EXPIRED_RUN_DEFERRALS} bounds how long a "possibly alive"
 *   answer can hold a run open. Before that ceiling existed, this branch
 *   returning `true` on one unreadable timestamp wedged the runner forever.
 */
export function isLiveStepProcess(
  pid: number,
  stepStartedAt: string | null | undefined,
  processStartedAt?: string | null,
): boolean {
  if (!isProcessAlive(pid)) return false;
  const actualMs = processStartTimeMs(pid);
  if (processStartedAt) return verifiedProcessStart(processStartedAt, actualMs);
  const stepStartMs = stepStartedAt ? Date.parse(stepStartedAt) : Number.NaN;
  if (actualMs === undefined || !Number.isFinite(stepStartMs)) return true;
  return actualMs >= stepStartMs - START_TIME_TOLERANCE_MS;
}

export function rowToLease(row: LeaseRow): DaemonLease {
  return {
    id: row.id,
    pid: row.pid,
    hostname: row.hostname,
    heartbeatAt: row.heartbeat_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface ClaimRunResult {
  run: LoopRun;
  loop: Loop;
  claimToken: string;
}

export interface CreateWorkflowRunInput {
  workflow: WorkflowSpec;
  loop?: Loop;
  loopRun?: LoopRun;
  scheduledFor?: string;
  idempotencyKey?: string;
  invocationId?: string;
  workItemId?: string;
  daemonLeaseId?: string;
  operationAuthority?: OperationAuthorityBinding;
  /** Internal deterministic fault-injection seam used to verify atomic initial event persistence. */
  beforeInitialWorkflowEventPersist?: (event: InitialAgentSessionContractEvent) => void;
}

export interface CreateGoalInput {
  objective: string;
  tokenBudget?: number;
  autoExecute?: GoalAutoExecute;
  maxTokens?: number;
  sourceType?: string;
  sourceId?: string;
  loopId?: string;
  loopRunId?: string;
  workflowId?: string;
  workflowRunId?: string;
  workflowStepId?: string;
}

export interface CreateGoalPlanNodeInput {
  key: string;
  objective: string;
  dependsOn?: string[];
  priority?: number;
  tokenBudget?: number;
}

export interface RecordRunProcessInput {
  pid: number;
  pgid?: number;
  processStartedAt?: string;
}

export interface RecoverExpiredRunLeasesResult {
  /** Runs whose lease expired with no live process; marked abandoned. */
  abandoned: LoopRun[];
  /** Runs whose lease expired while their process (group) is still alive; lease deferred. */
  deferred: LoopRun[];
  /** Runs left unchanged because an admitted private operation has no terminal receipt. */
  operationReconciliationRequired: LoopRun[];
}

export interface ExpiredRunLeaseCandidate {
  runId: string;
  loopId: string;
  leaseExpiresAt: string;
  updatedAt: string;
}

export interface ExpiredRunLeaseCandidatePage {
  candidates: ExpiredRunLeaseCandidate[];
  truncated: boolean;
}

export interface RecoveredLeaseRunPage {
  runs: LoopRun[];
  snapshot?: RecoveredLeaseRunSnapshotEntry[];
  nextOffset?: number;
}

export interface PruneHistoryOptions {
  /** Delete terminal runs whose created_at is older than this many days. */
  maxAgeDays?: number;
  /** Always retain at least this many of the most recent runs per loop. */
  keepPerLoop?: number;
  /** Report what would be deleted without deleting anything. */
  dryRun?: boolean;
  /** Injectable clock for tests. */
  now?: Date;
}

export interface PruneHistorySummary {
  dryRun: boolean;
  cutoff?: string;
  keepPerLoop?: number;
  loopRuns: number;
  workflowRuns: number;
  goalRuns: number;
}

export interface StoreMigrationRows {
  schemaVersion: number;
  workflows: WorkflowSpec[];
  loops: Loop[];
  runs: LoopRun[];
  checks: StoreMigrationChecks;
}

export interface StoreMigrationUnsupportedCounts {
  workflowInvocations: number;
  workflowWorkItems: number;
  workflowRuns: number;
  workflowStepRuns: number;
  workflowEvents: number;
  goals: number;
  goalPlanNodes: number;
  goalRuns: number;
}

export interface StoreMigrationVolatileCounts {
  daemonLeases: number;
  activeDaemonLeases: number;
  runningLoopRuns: number;
  runningWorkflowRuns: number;
  runningWorkflowStepRuns: number;
  leasedWorkflowWorkItems: number;
}

export interface StoreMigrationChecks {
  unsupportedCounts: StoreMigrationUnsupportedCounts;
  volatileCounts: StoreMigrationVolatileCounts;
}

export interface StoreMigrationRowsOptions {
  includeRuns?: boolean;
}

export interface StoreMigrationUpsertOptions {
  replace?: boolean;
}

export interface RecordGoalEventInput {
  goalId: string;
  turn?: number;
  phase: GoalRun["phase"];
  status: GoalRun["status"];
  nodeKey?: string;
  tokensUsed?: number;
  evidence?: Record<string, unknown>;
  rawResponse?: unknown;
}

export function workItemStatusForLoopRun(
  status: RunStatus,
  attempt: number,
  maxAttempts: number | undefined,
): WorkflowWorkItemStatus | undefined {
  if (status === "succeeded") return "succeeded";
  if (["failed", "timed_out", "abandoned"].includes(status)) {
    return maxAttempts !== undefined && attempt < maxAttempts ? "admitted" : "failed";
  }
  return undefined;
}

/**
 * `exit(75)` = `EX_TEMPFAIL`: the sysexits.h "temporary failure, retry later"
 * code. A gate/worker step that exits 75 (e.g. an account-quota probe that is
 * still dry) is signalling "not now", not a real failed attempt — so it must
 * not burn the todos-task redispatch cap and must leave the work item
 * requeueable rather than persisting as a terminal, dedupe-forever row.
 */
export const WORK_ITEM_TEMPFAIL_EXIT_CODE = 75;

/**
 * Workflow step ids that run BEFORE the worker does any real work. A failure in
 * one of these (triage/planner gate, or the pre-step worktree preparation) that
 * dies quickly is a "gate death": the run never executed the worker, so it must
 * not count toward the redispatch cap (otherwise a purely infrastructural fault
 * — e.g. a stale worktree registration — silently dead-letters a task that
 * never actually ran).
 */
export const GATE_STEP_IDS: ReadonlySet<string> = new Set(["triage", "planner", "plan"]);

/** A gate-step failure only counts as a gate death when it dies before any real
 *  work could have happened. Worktree-prep deaths are always gate deaths (they
 *  fail before the agent is spawned) regardless of this bound. */
export const GATE_DEATH_MAX_DURATION_MS = 60_000;

/**
 * Secondary ceiling for CONSECUTIVE gate deaths. Gate deaths refund their
 * redispatch attempt (the worker never ran), which is correct for transient
 * infrastructure faults — but a deterministic fault (e.g. a permanently broken
 * repo path) would otherwise retry forever at the backoff floor. After this
 * many consecutive gate deaths the work item is dead-lettered (visible in
 * drain reports) instead of spinning; any run that reaches the worker resets
 * the streak, and an operator requeue (attempts reset) re-arms it. At the
 * ~2–4 minute refunded-attempts backoff this bounds a deterministic fault to
 * roughly an hour of auto-retry before it demands an operator.
 */
export const GATE_DEATH_CEILING = 20;

export type NonProductiveFailureKind = "tempfail" | "gate-death";

type ClassifiableStepRun = Pick<WorkflowStepRun, "stepId" | "status" | "exitCode" | "durationMs" | "error">;

/**
 * Classify a just-finalized *failed* workflow run's decisive failing step. A
 * non-productive finish (a tempfail retry-signal, or a gate death before the
 * worker ran) must not count toward the todos-task redispatch cap. Returns the
 * non-productive kind, or `undefined` when the run represents a real worker
 * attempt that legitimately counts toward the cap. Pure/exported for tests.
 */
export function classifyNonProductiveStepFailure(steps: ClassifiableStepRun[]): NonProductiveFailureKind | undefined {
  // Steps arrive in sequence order; the decisive step is the last one that
  // failed or timed out (a later gate stop never reaches earlier successes).
  const failing = [...steps].reverse().find((step) => step.status === "failed" || step.status === "timed_out");
  if (!failing) return undefined;
  if (failing.exitCode === WORK_ITEM_TEMPFAIL_EXIT_CODE) return "tempfail";
  // Worktree preparation fails before the agent process is spawned, so it is a
  // gate death by definition — no real work happened — independent of duration.
  if (typeof failing.error === "string" && failing.error.includes("worktree preparation failed")) return "gate-death";
  const fast = failing.durationMs === undefined || failing.durationMs < GATE_DEATH_MAX_DURATION_MS;
  if (GATE_STEP_IDS.has(failing.stepId) && fast) return "gate-death";
  return undefined;
}

export function scrubbedOrNull(value: string | undefined | null): string | null {
  return value == null ? null : scrubSecrets(value);
}

/**
 * Max characters of stdout/stderr persisted per run/step. Agent runs (codewith
 * `exec --json` rollouts) can emit multi-megabyte output; storing it verbatim on
 * every terminal run is what regrew loops.db ~100MB/day. Oversized output is
 * kept as head + tail around a truncation marker so evidence stays useful.
 */
const MAX_PERSISTED_RUN_OUTPUT_CHARS = 64 * 1024;
const MAX_PERSISTED_WORKFLOW_EVENT_PAYLOAD_CHARS = 64 * 1024;

function clampPersistedRunOutput(value: string | null): string | null {
  if (value == null || value.length <= MAX_PERSISTED_RUN_OUTPUT_CHARS) return value;
  const half = Math.floor(MAX_PERSISTED_RUN_OUTPUT_CHARS / 2);
  const head = value.slice(0, half);
  const tail = value.slice(value.length - half);
  const omitted = value.length - head.length - tail.length;
  return `${head}\n…[${omitted} chars truncated by loops run-output retention]…\n${tail}`;
}

/** Scrub secrets then bound size before persisting run stdout/stderr. */
export function persistedRunOutput(value: string | undefined | null): string | null {
  return clampPersistedRunOutput(scrubbedOrNull(value));
}

/** Scrub structured string leaves before stringify, then scrub the encoded JSON. */
export function persistedJson(value: unknown): string {
  return scrubSecrets(JSON.stringify(scrubSecretsDeep(value)));
}

function clampTextToChars(value: string, maxChars: number, reason: string): string {
  if (value.length <= maxChars) return value;
  const marker = `\n...[truncated by ${reason}]...\n`;
  const budget = Math.max(0, maxChars - marker.length);
  const headLength = Math.ceil(budget / 2);
  const tailLength = Math.floor(budget / 2);
  return `${value.slice(0, headLength)}${marker}${value.slice(value.length - tailLength)}`;
}

function boundedWorkflowEventPayloadJson(scrubbedJson: string): string {
  if (scrubbedJson.length <= MAX_PERSISTED_WORKFLOW_EVENT_PAYLOAD_CHARS) return scrubbedJson;

  const base = {
    truncated: true,
    originalChars: scrubbedJson.length,
    maxChars: MAX_PERSISTED_WORKFLOW_EVENT_PAYLOAD_CHARS,
    preview: "",
  };
  const baseChars = JSON.stringify(base).length;
  let previewBudget = Math.max(0, MAX_PERSISTED_WORKFLOW_EVENT_PAYLOAD_CHARS - baseChars - 64);

  while (true) {
    const preview = clampTextToChars(scrubbedJson, previewBudget, "loops workflow-event payload retention");
    const bounded = JSON.stringify({ ...base, preview });
    if (bounded.length <= MAX_PERSISTED_WORKFLOW_EVENT_PAYLOAD_CHARS || previewBudget === 0) return bounded;
    previewBudget = Math.max(0, previewBudget - (bounded.length - MAX_PERSISTED_WORKFLOW_EVENT_PAYLOAD_CHARS) - 64);
  }
}

export function persistedWorkflowEventPayload(payload: Record<string, unknown> | undefined | null): string | null {
  if (payload == null) return null;
  return boundedWorkflowEventPayloadJson(persistedJson(payload));
}

function chmodIfExists(path: string, mode: number): void {
  try {
    if (existsSync(path)) chmodSync(path, mode);
  } catch {
    // Permission hardening is best-effort because external filesystems can reject chmod.
  }
}

function ensurePrivateStorePath(file: string): void {
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodIfExists(dir, 0o700);
  chmodIfExists(file, 0o600);
  chmodIfExists(`${file}-wal`, 0o600);
  chmodIfExists(`${file}-shm`, 0o600);
}

export class Store {
  private db: Database;
  private rootDir: string;
  /** Temp dir created for a `:memory:` store, removed in close() so tests/short-lived instances don't leak it. */
  private memoryRootDir?: string;

  constructor(path?: string) {
    const file = path ?? dbPath();
    if (file !== ":memory:") ensurePrivateStorePath(file);
    this.rootDir = file === ":memory:" ? mkdtempSync(join(tmpdir(), "open-loops-store-")) : dirname(file);
    if (file === ":memory:") this.memoryRootDir = this.rootDir;
    this.db = new Database(file);
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    if (file !== ":memory:") ensurePrivateStorePath(file);
    try {
      this.migrate();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS schema_compat (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        min_compatible_user_version INTEGER NOT NULL
      );
    `);
    const versionRow = this.db.query<{ user_version: number }, []>("PRAGMA user_version").get();
    const userVersion = versionRow?.user_version ?? 0;
    if (userVersion > SCHEMA_USER_VERSION) {
      // A newer binary migrated this database. Refusing outright bricked the
      // CLI fleet during the 2026-07-07 schema-8 lockout even though the newer
      // migrations were purely additive. The database itself carries the
      // compatibility floor (`schema_compat.min_compatible_user_version`,
      // raised only by BREAKING migrations): open when this binary meets the
      // floor; refuse only on a known-breaking delta. A newer-version database
      // WITHOUT the floor row predates this contract (or came from an
      // unblessed build) — stay conservative and refuse as before.
      const floorRow = this.db
        .query<{ min_compatible_user_version: number }, []>(
          "SELECT min_compatible_user_version FROM schema_compat WHERE id = 1",
        )
        .get();
      if (!floorRow) {
        throw new Error(
          `loops database schema version ${userVersion} is newer than this binary supports (${SCHEMA_USER_VERSION}) and carries no compatibility floor; upgrade Loops before opening this database`,
        );
      }
      if (SCHEMA_USER_VERSION < floorRow.min_compatible_user_version) {
        throw new Error(
          `loops database schema version ${userVersion} requires a binary with schema support >= ${floorRow.min_compatible_user_version} (this binary supports ${SCHEMA_USER_VERSION}); upgrade Loops before opening this database`,
        );
      }
      // Soft-open: everything beyond this binary's knowledge is declared
      // non-breaking by the floor. The migration loop below only re-applies
      // idempotent baselines / already-applied ids, and the newer
      // user_version stamp is preserved (never downgraded).
    }
    const applied = new Set(this.db.query<{ id: string }, []>("SELECT id FROM schema_migrations").all().map((row) => row.id));
    for (const migration of this.migrations()) {
      // Numbered migrations run only when absent from schema_migrations.
      // Baseline migrations (0001-0005) are the exception: historical binaries
      // stamped those rows unconditionally regardless of what their DDL
      // actually contained, so their idempotent DDL is always re-applied to
      // converge drifted databases. This also reconciles the live fork that
      // recorded a second 0004_* migration row and added the orphan columns
      // loops.metadata_json / loop_runs.source — unknown migration ids are
      // tolerated and orphan columns are additive, never dropped.
      if (!migration.baseline && applied.has(migration.id)) continue;
      migration.apply();
      if (!applied.has(migration.id)) {
        this.db.query("INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(migration.id, nowIso());
      }
    }
    // Stamp forward only — a soft-opened newer database keeps its newer stamp.
    if (userVersion < SCHEMA_USER_VERSION) this.db.exec(`PRAGMA user_version = ${SCHEMA_USER_VERSION}`);
    // Maintain the database-carried compatibility floor. MAX() so a higher
    // floor written by a newer binary is never lowered by an older one.
    this.db
      .query(
        `INSERT INTO schema_compat (id, min_compatible_user_version) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET min_compatible_user_version = MAX(min_compatible_user_version, excluded.min_compatible_user_version)`,
      )
      .run(BREAKING_SCHEMA_FLOOR);
  }

  private migrations(): Array<{ id: string; baseline?: boolean; apply: () => void }> {
    return [
      { id: "0001_initial_and_workflows", baseline: true, apply: () => this.createBaseSchema() },
      { id: "0002_loop_machines", baseline: true, apply: () => this.addColumnIfMissing("loops", "machine_json", "TEXT") },
      {
        id: "0003_goals",
        baseline: true,
        apply: () => {
          this.addColumnIfMissing("loops", "goal_json", "TEXT");
          this.addColumnIfMissing("loop_runs", "goal_run_id", "TEXT");
          this.addColumnIfMissing("workflow_specs", "goal_json", "TEXT");
          this.addColumnIfMissing("workflow_runs", "goal_run_id", "TEXT");
          this.addColumnIfMissing("workflow_step_runs", "goal_run_id", "TEXT");
        },
      },
      {
        id: "0004_loop_archive_metadata",
        baseline: true,
        apply: () => {
          this.addColumnIfMissing("loops", "archived_at", "TEXT");
          this.addColumnIfMissing("loops", "archived_from_status", "TEXT");
        },
      },
      {
        id: "0005_workflow_invocations_and_admission",
        baseline: true,
        apply: () => {
          this.addColumnIfMissing("workflow_runs", "invocation_id", "TEXT");
          this.addColumnIfMissing("workflow_runs", "work_item_id", "TEXT");
          this.addColumnIfMissing("workflow_runs", "manifest_path", "TEXT");
          this.addColumnIfMissing("workflow_step_runs", "pid", "INTEGER");
          this.createWorkflowRunBackfillIndexes();
        },
      },
      {
        id: "0006_run_process_tracking",
        apply: () => {
          this.addColumnIfMissing("loop_runs", "pgid", "INTEGER");
          this.addColumnIfMissing("loop_runs", "process_started_at", "TEXT");
        },
      },
      {
        id: "0007_run_claim_tokens",
        apply: () => {
          this.addColumnIfMissing("loop_runs", "claim_token", "TEXT");
          this.db.exec("CREATE INDEX IF NOT EXISTS idx_runs_claim_token ON loop_runs(claim_token) WHERE claim_token IS NOT NULL");
        },
      },
      {
        id: "0008_work_item_route_scope",
        apply: () => {
          // Per-route --max-active scoping: the global admission count is filtered
          // by the drain/route (loop) that set the limit instead of counting the
          // whole store. Existing in-flight rows keep route_scope NULL and simply
          // fall out of any new scoped count (biases toward more admission, never
          // less); per-project/per-group counts are unaffected.
          //
          // route_scope is nullable + additive, so SCHEMA_USER_VERSION is
          // intentionally NOT bumped: a rolled-back older binary must still open a
          // DB this migration touched (it ignores the column and tolerates the
          // extra schema_migrations row). Bumping would make the daemon refuse the
          // DB on downgrade — a fleet-wide outage risk during rollout.
          this.addColumnIfMissing("workflow_work_items", "route_scope", "TEXT");
          this.db.exec("CREATE INDEX IF NOT EXISTS idx_workflow_work_items_scope ON workflow_work_items(route_scope, status)");
        },
      },
      {
        id: "0009_run_receipts",
        apply: () => this.createRunReceiptsSchema(),
      },
      {
        id: "0010_work_item_machine_id",
        apply: () => {
          // Nullable + additive reservation evidence. Keep downgrade behavior
          // lenient like route_scope: older binaries ignore the extra column.
          this.addColumnIfMissing("workflow_work_items", "machine_id", "TEXT");
          this.db.exec("CREATE INDEX IF NOT EXISTS idx_workflow_work_items_machine ON workflow_work_items(machine_id, status)");
        },
      },
      {
        id: "0011_work_item_gate_deaths",
        apply: () => {
          // Additive counter of CONSECUTIVE gate deaths (runs that failed
          // before doing real work: worktree prep / fast triage-planner).
          // Gate deaths refund their redispatch attempt, so without a second
          // ceiling a deterministic infrastructure fault retries forever at
          // the backoff floor; this bounds it. Older binaries ignore the
          // column (defaults keep counting from 0 if they write rows) — no
          // SCHEMA_USER_VERSION bump, purely additive.
          this.addColumnIfMissing("workflow_work_items", "gate_deaths", "INTEGER NOT NULL DEFAULT 0");
        },
      },
      {
        id: "0012_workflow_run_provenance",
        apply: () => {
          // Immutable idempotency provenance. NULL marks pre-migration runs,
          // which fail closed on retry because their creating definition is
          // unknowable. Purely additive; older binaries safely ignore it.
          this.addColumnIfMissing("workflow_runs", "workflow_definition_hash", "TEXT");
        },
      },
      {
        id: "0013_loop_labels",
        apply: () => {
          // Additive metadata: old binaries ignore the column, while new
          // binaries normalize legacy NULL/absent state to an empty label set.
          // Keep user_version and the compatibility floor unchanged.
          this.addColumnIfMissing("loops", "labels_json", "TEXT NOT NULL DEFAULT '[]'");
        },
      },
      {
        id: "0014_run_defer_ceiling_and_step_process_fingerprint",
        apply: () => {
          // Additive on both counts; old binaries ignore the columns and keep
          // their previous (unbounded, unfingerprinted) behaviour, so
          // user_version and the compatibility floor stay unchanged.
          //
          // loop_runs.defer_count bounds lease-recovery deferrals
          // (MAX_LIVE_EXPIRED_RUN_DEFERRALS).
          this.addColumnIfMissing("loop_runs", "defer_count", "INTEGER NOT NULL DEFAULT 0");
          // workflow_step_runs.process_started_at gives step pids the same
          // start-time fingerprint loop_runs got in 0006, so a recycled step
          // pid can be rejected by identity instead of by a one-sided
          // lower-bound guess. Rows written before this migration have no
          // fingerprint and stay lenient — bounded by the deferral ceiling.
          this.addColumnIfMissing("workflow_step_runs", "process_started_at", "TEXT");
        },
      },
      {
        id: "0015_loop_mutation_contract",
        apply: () => this.createLoopMutationSchema(),
      },
      {
        id: "0016_loop_expires_after_runs",
        apply: () => {
          // Additive run-count expiry ceiling (--expires-after-runs): the loop
          // expires after N consecutive successful runs. Old binaries ignore
          // the column and keep running forever — no user_version bump.
          this.addColumnIfMissing("loops", "expires_after_runs", "INTEGER");
        },
      },
      {
        id: "0017_loop_revisions",
        apply: () => this.createLoopRevisionSchema(),
      },
    ];
  }

  private createBaseSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS loops (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        labels_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL,
        archived_at TEXT,
        archived_from_status TEXT,
        schedule_json TEXT NOT NULL,
        target_json TEXT NOT NULL,
        goal_json TEXT,
        machine_json TEXT,
        next_run_at TEXT,
        retry_scheduled_for TEXT,
        catch_up TEXT NOT NULL,
        catch_up_limit INTEGER NOT NULL,
        overlap TEXT NOT NULL,
        max_attempts INTEGER NOT NULL,
        retry_delay_ms INTEGER NOT NULL,
        lease_ms INTEGER NOT NULL,
        expires_at TEXT,
        expires_after_runs INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_loops_status_next ON loops(status, next_run_at);
      CREATE INDEX IF NOT EXISTS idx_loops_name ON loops(name);

      CREATE TABLE IF NOT EXISTS loop_runs (
        id TEXT PRIMARY KEY,
        loop_id TEXT NOT NULL,
        loop_name TEXT NOT NULL,
        scheduled_for TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        claimed_by TEXT,
        claim_token TEXT,
        lease_expires_at TEXT,
        pid INTEGER,
        pgid INTEGER,
        process_started_at TEXT,
        defer_count INTEGER NOT NULL DEFAULT 0,
        exit_code INTEGER,
        duration_ms INTEGER,
        stdout TEXT,
        stderr TEXT,
        error TEXT,
        goal_run_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(loop_id, scheduled_for)
      );
      CREATE INDEX IF NOT EXISTS idx_runs_loop ON loop_runs(loop_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_runs_status ON loop_runs(status);
      CREATE INDEX IF NOT EXISTS idx_runs_status_lease ON loop_runs(status, lease_expires_at);
      CREATE INDEX IF NOT EXISTS idx_runs_scheduled ON loop_runs(scheduled_for);

      CREATE TABLE IF NOT EXISTS run_receipts (
        run_id TEXT PRIMARY KEY,
        loop_id TEXT NOT NULL,
        machine_json TEXT NOT NULL,
        repo TEXT NOT NULL,
        task_ids_json TEXT NOT NULL,
        knowledge_ids_json TEXT NOT NULL,
        digest_id TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        status TEXT NOT NULL,
        exit_code INTEGER,
        summary_json TEXT NOT NULL,
        evidence_paths_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_run_receipts_loop ON run_receipts(loop_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_run_receipts_repo ON run_receipts(repo, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_run_receipts_digest ON run_receipts(digest_id);
      CREATE INDEX IF NOT EXISTS idx_run_receipts_status ON run_receipts(status, created_at DESC);

      CREATE TABLE IF NOT EXISTS loop_mutation_operations (
        tenant_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        binding_digest TEXT NOT NULL,
        binding_json TEXT NOT NULL,
        admission_json TEXT NOT NULL,
        terminal_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, operation_id, step_id)
      );
      CREATE INDEX IF NOT EXISTS idx_loop_mutation_target ON loop_mutation_operations(tenant_id, target_id, created_at DESC);
      CREATE TRIGGER IF NOT EXISTS loop_mutation_operations_no_update
      BEFORE UPDATE ON loop_mutation_operations
      BEGIN
        SELECT RAISE(ABORT, 'loop mutation receipts are immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS loop_mutation_operations_no_delete
      BEFORE DELETE ON loop_mutation_operations
      BEGIN
        SELECT RAISE(ABORT, 'loop mutation receipts are immutable');
      END;

      CREATE TABLE IF NOT EXISTS loop_mutation_leases (
        tenant_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        lease_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, target_id),
        UNIQUE (tenant_id, lease_id)
      );

      CREATE TABLE IF NOT EXISTS daemon_lease (
        id TEXT PRIMARY KEY,
        pid INTEGER NOT NULL,
        hostname TEXT NOT NULL,
        heartbeat_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workflow_specs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        version INTEGER NOT NULL,
        status TEXT NOT NULL,
        goal_json TEXT,
        steps_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_workflows_status_name ON workflow_specs(status, name);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_workflows_name_active ON workflow_specs(name) WHERE status = 'active';

      CREATE TABLE IF NOT EXISTS workflow_runs (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL REFERENCES workflow_specs(id) ON DELETE CASCADE,
        workflow_name TEXT NOT NULL,
        loop_id TEXT REFERENCES loops(id) ON DELETE SET NULL,
        loop_run_id TEXT REFERENCES loop_runs(id) ON DELETE SET NULL,
        invocation_id TEXT,
        work_item_id TEXT,
        scheduled_for TEXT,
        idempotency_key TEXT,
        manifest_path TEXT,
        status TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        duration_ms INTEGER,
        error TEXT,
        goal_run_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_runs_idempotency
        ON workflow_runs(workflow_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_created ON workflow_runs(workflow_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_loop_run ON workflow_runs(loop_run_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);

      CREATE TABLE IF NOT EXISTS workflow_invocations (
        id TEXT PRIMARY KEY,
        workflow_id TEXT,
        template_id TEXT,
        source_kind TEXT NOT NULL,
        source_id TEXT,
        source_dedupe_key TEXT,
        source_json TEXT NOT NULL,
        subject_kind TEXT NOT NULL,
        subject_id TEXT,
        subject_path TEXT,
        subject_url TEXT,
        subject_json TEXT NOT NULL,
        intent TEXT NOT NULL,
        scope_json TEXT,
        output_policy_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_workflow_invocations_source ON workflow_invocations(source_kind, source_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_invocations_subject ON workflow_invocations(subject_kind, subject_id, subject_path);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_invocations_dedupe
        ON workflow_invocations(source_kind, source_dedupe_key)
        WHERE source_dedupe_key IS NOT NULL;

      CREATE TABLE IF NOT EXISTS workflow_work_items (
        id TEXT PRIMARY KEY,
        route_key TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        invocation_id TEXT NOT NULL REFERENCES workflow_invocations(id) ON DELETE CASCADE,
        source_type TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        subject_ref TEXT NOT NULL,
        project_key TEXT,
        project_group TEXT,
        machine_id TEXT,
        route_scope TEXT,
        priority INTEGER NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        next_attempt_at TEXT,
        lease_expires_at TEXT,
        workflow_id TEXT REFERENCES workflow_specs(id) ON DELETE SET NULL,
        loop_id TEXT REFERENCES loops(id) ON DELETE SET NULL,
        workflow_run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL,
        last_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(route_key, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS idx_workflow_work_items_status_next ON workflow_work_items(status, next_attempt_at, priority DESC, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_workflow_work_items_project ON workflow_work_items(project_key, status);
      CREATE INDEX IF NOT EXISTS idx_workflow_work_items_group ON workflow_work_items(project_group, status);
      CREATE INDEX IF NOT EXISTS idx_workflow_work_items_invocation ON workflow_work_items(invocation_id);
      -- New-column indexes (route_scope, machine_id, etc.) are created ONLY by
      -- their additive migrations, never here: this baseline DDL
      -- re-runs on EVERY open (0001 is not skip-guarded), and on a pre-0008
      -- database the CREATE TABLE above is a no-op, so an index on a new column
      -- here would execute before the column exists and crash the open
      -- ("no such column: route_scope"). New columns may be folded into the
      -- CREATE TABLE (fresh-db only); their indexes must live in the migration.

      CREATE TABLE IF NOT EXISTS workflow_step_runs (
        id TEXT PRIMARY KEY,
        workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
        step_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        exit_code INTEGER,
        pid INTEGER,
        process_started_at TEXT,
        duration_ms INTEGER,
        stdout TEXT,
        stderr TEXT,
        error TEXT,
        account_profile TEXT,
        account_tool TEXT,
        goal_run_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(workflow_run_id, step_id)
      );
      CREATE INDEX IF NOT EXISTS idx_workflow_step_runs_run_sequence ON workflow_step_runs(workflow_run_id, sequence);
      CREATE INDEX IF NOT EXISTS idx_workflow_step_runs_status ON workflow_step_runs(status);

      CREATE TABLE IF NOT EXISTS workflow_events (
        id TEXT PRIMARY KEY,
        workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        step_id TEXT,
        payload_json TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(workflow_run_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS idx_workflow_events_run_sequence ON workflow_events(workflow_run_id, sequence);

      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        objective TEXT NOT NULL,
        status TEXT NOT NULL,
        token_budget INTEGER,
        tokens_used INTEGER NOT NULL,
        time_used_seconds INTEGER NOT NULL,
        auto_execute TEXT NOT NULL,
        max_tokens INTEGER,
        source_type TEXT,
        source_id TEXT,
        loop_id TEXT,
        loop_run_id TEXT,
        workflow_id TEXT,
        workflow_run_id TEXT,
        workflow_step_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_goals_status_updated ON goals(status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_goals_loop_run ON goals(loop_run_id);
      CREATE INDEX IF NOT EXISTS idx_goals_workflow_run ON goals(workflow_run_id);
      CREATE INDEX IF NOT EXISTS idx_goals_source ON goals(source_type, source_id);

      CREATE TABLE IF NOT EXISTS goal_plan_nodes (
        id TEXT PRIMARY KEY,
        goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        plan_id TEXT NOT NULL,
        key TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        priority INTEGER NOT NULL,
        objective TEXT NOT NULL,
        status TEXT NOT NULL,
        ready INTEGER NOT NULL,
        token_budget INTEGER,
        tokens_used INTEGER NOT NULL,
        time_used_seconds INTEGER NOT NULL,
        depends_on_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(plan_id, key)
      );
      CREATE INDEX IF NOT EXISTS idx_goal_plan_nodes_goal_sequence ON goal_plan_nodes(goal_id, sequence);
      CREATE INDEX IF NOT EXISTS idx_goal_plan_nodes_status ON goal_plan_nodes(status);

      CREATE TABLE IF NOT EXISTS goal_runs (
        id TEXT PRIMARY KEY,
        goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        plan_id TEXT NOT NULL,
        loop_id TEXT,
        loop_run_id TEXT,
        workflow_id TEXT,
        workflow_run_id TEXT,
        workflow_step_id TEXT,
        turn INTEGER NOT NULL,
        phase TEXT NOT NULL,
        status TEXT NOT NULL,
        node_key TEXT,
        tokens_used INTEGER NOT NULL,
        evidence_json TEXT,
        raw_response_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_goal_runs_goal_created ON goal_runs(goal_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_goal_runs_loop_run ON goal_runs(loop_run_id);
      CREATE INDEX IF NOT EXISTS idx_goal_runs_workflow_run ON goal_runs(workflow_run_id);
    `);
  }

  /**
   * `loop_revisions` — the append-only bundle ledger, plus the two columns on
   * `loops` that point into it.
   *
   * Additive on every axis (nullable columns, a new table), so
   * SCHEMA_USER_VERSION and the compatibility floor stay unchanged: an older
   * binary opening this database ignores the table and keeps scheduling.
   *
   * Append-only is enforced by TRIGGER here rather than by privilege (sqlite
   * has no roles): the Postgres mirror revokes UPDATE/DELETE from the runtime
   * role instead. Either way "the ledger is never rewritten" is a property of
   * the database, not a convention in the code that writes to it.
   */
  private createLoopRevisionSchema(): void {
    this.addColumnIfMissing("loops", "bundle_name", "TEXT");
    // Run provenance: which bundle version produced a run. Nullable, so every
    // pre-bundle receipt keeps its exact digest.
    this.addColumnIfMissing("run_receipts", "bundle_json", "TEXT");
    this.addColumnIfMissing("loops", "bundle_pinned_version", "INTEGER");
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_loops_bundle_name ON loops(bundle_name) WHERE bundle_name IS NOT NULL;
      CREATE TABLE IF NOT EXISTS loop_revisions (
        loop_id TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version >= 1),
        bundle_name TEXT NOT NULL,
        bundle_digest TEXT NOT NULL,
        archive_sha256 TEXT NOT NULL,
        archive_bytes INTEGER NOT NULL CHECK (archive_bytes > 0),
        storage_kind TEXT NOT NULL DEFAULT 'db' CHECK (storage_kind IN ('db','s3')),
        storage_key TEXT,
        manifest_json TEXT NOT NULL DEFAULT '{}',
        loop_json TEXT NOT NULL,
        carries_prompt INTEGER NOT NULL DEFAULT 0,
        author TEXT NOT NULL,
        source_station TEXT,
        source_agent TEXT,
        reason TEXT,
        rolled_back_from INTEGER,
        created_at TEXT NOT NULL,
        PRIMARY KEY (loop_id, version),
        FOREIGN KEY (loop_id) REFERENCES loops(id) ON DELETE CASCADE,
        CHECK (storage_kind <> 's3' OR storage_key IS NOT NULL)
      );
      CREATE INDEX IF NOT EXISTS idx_loop_revisions_loop ON loop_revisions(loop_id, version DESC);
      CREATE INDEX IF NOT EXISTS idx_loop_revisions_digest ON loop_revisions(bundle_digest);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_loop_revisions_name_version ON loop_revisions(bundle_name, version);
      CREATE TRIGGER IF NOT EXISTS loop_revisions_no_update
      BEFORE UPDATE ON loop_revisions
      BEGIN
        SELECT RAISE(ABORT, 'loop revisions are append-only');
      END;
    `);
  }

  private createRunReceiptsSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS run_receipts (
        run_id TEXT PRIMARY KEY,
        loop_id TEXT NOT NULL,
        machine_json TEXT NOT NULL,
        repo TEXT NOT NULL,
        task_ids_json TEXT NOT NULL,
        knowledge_ids_json TEXT NOT NULL,
        digest_id TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        status TEXT NOT NULL,
        exit_code INTEGER,
        summary_json TEXT NOT NULL,
        evidence_paths_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_run_receipts_loop ON run_receipts(loop_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_run_receipts_repo ON run_receipts(repo, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_run_receipts_digest ON run_receipts(digest_id);
      CREATE INDEX IF NOT EXISTS idx_run_receipts_status ON run_receipts(status, created_at DESC);
    `);
  }

  private createLoopMutationSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS loop_mutation_operations (
        tenant_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        binding_digest TEXT NOT NULL,
        binding_json TEXT NOT NULL,
        admission_json TEXT NOT NULL,
        terminal_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, operation_id, step_id)
      );
      CREATE INDEX IF NOT EXISTS idx_loop_mutation_target ON loop_mutation_operations(tenant_id, target_id, created_at DESC);
      CREATE TRIGGER IF NOT EXISTS loop_mutation_operations_no_update
      BEFORE UPDATE ON loop_mutation_operations
      BEGIN
        SELECT RAISE(ABORT, 'loop mutation receipts are immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS loop_mutation_operations_no_delete
      BEFORE DELETE ON loop_mutation_operations
      BEGIN
        SELECT RAISE(ABORT, 'loop mutation receipts are immutable');
      END;
      CREATE TABLE IF NOT EXISTS loop_mutation_leases (
        tenant_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        lease_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, target_id),
        UNIQUE (tenant_id, lease_id)
      );
    `);
  }

  /**
   * Add a column only if it does not already exist. Idempotent — avoids the
   * "duplicate column name" error that SQLite logs (via libsqlite3, before any
   * JS try/catch) when re-running an additive migration on a database that has
   * already been upgraded. Table/column/definition come from hardcoded literals
   * in {@link migrate}, never user input, so interpolation here is safe.
   */
  private addColumnIfMissing(table: string, column: string, definition: string): void {
    const columns = this.db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (columns.some((c) => c.name === column)) return;
    this.db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }

  private createWorkflowRunBackfillIndexes(): void {
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_invocation ON workflow_runs(invocation_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_work_item ON workflow_runs(work_item_id);
    `);
  }

  /** Run `fn` inside a write transaction unless the caller already opened one. */
  private transact<T>(fn: () => T): T {
    return this.db.inTransaction ? fn() : this.writeTransaction(fn);
  }

  private assertDaemonLeaseFence(opts: DaemonLeaseFence = {}, now: string = nowIso()): void {
    if (!opts.daemonLeaseId) return;
    const row = this.db
      .query<{ id: string }, [string, string]>("SELECT id FROM daemon_lease WHERE id = ? AND expires_at > ?")
      .get(opts.daemonLeaseId, now);
    if (!row) throw new Error("daemon lease lost");
  }

  private assertNoNestedWorkflowGoal(target: LoopTarget, goal: GoalSpec | undefined): void {
    if (!goal || target.type !== "workflow") return;
    const workflow = this.getWorkflow(target.workflowId);
    if (workflow?.goal) {
      throw new Error(
        `workflow loop cannot define a loop-level goal when workflow ${workflow.name} already has a top-level goal; remove one goal wrapper`,
      );
    }
  }

  createLoop(input: CreateLoopInput, from: Date = new Date()): Loop {
    const now = nowIso();
    const target =
      input.target.type === "workflow"
        ? input.target
        : normalizeCreateWorkflowInput({
            name: "loop-target-validation",
            steps: [{ id: "target", target: input.target }],
          }).steps[0]!.target;
    this.assertNoNestedWorkflowGoal(target, input.goal);
    const loop: Loop = {
      id: genId(),
      name: input.name,
      description: input.description,
      labels: normalizeLoopLabels(input.labels),
      status: "active",
      schedule: input.schedule,
      target,
      goal: input.goal,
      machine: input.machine,
      nextRunAt: initialNextRun(input.schedule, from),
      catchUp: input.catchUp ?? "latest",
      catchUpLimit: input.catchUpLimit ?? 50,
      overlap: input.overlap ?? "skip",
      maxAttempts: input.maxAttempts ?? 1,
      retryDelayMs: input.retryDelayMs ?? 60_000,
      leaseMs: input.leaseMs ?? 30 * 60_000,
      expiresAt: input.expiresAt,
      expiresAfterRuns: input.expiresAfterRuns,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .query(
        `INSERT INTO loops (id, name, description, labels_json, status, schedule_json, target_json, machine_json, next_run_at, retry_scheduled_for,
          goal_json, catch_up, catch_up_limit, overlap, max_attempts, retry_delay_ms, lease_ms, expires_at, expires_after_runs, created_at, updated_at)
         VALUES ($id, $name, $description, $labels, $status, $schedule, $target, $machine, $nextRun, NULL, $goal, $catchUp, $catchUpLimit,
          $overlap, $maxAttempts, $retryDelay, $leaseMs, $expiresAt, $expiresAfterRuns, $created, $updated)`,
      )
      .run({
        $id: loop.id,
        $name: loop.name,
        $description: loop.description ?? null,
        $labels: JSON.stringify(loop.labels),
        $status: loop.status,
        $schedule: JSON.stringify(loop.schedule),
        $target: JSON.stringify(loop.target),
        $machine: loop.machine ? JSON.stringify(loop.machine) : null,
        $goal: loop.goal ? JSON.stringify(loop.goal) : null,
        $nextRun: loop.nextRunAt ?? null,
        $catchUp: loop.catchUp,
        $catchUpLimit: loop.catchUpLimit,
        $overlap: loop.overlap,
        $maxAttempts: loop.maxAttempts,
        $retryDelay: loop.retryDelayMs,
        $leaseMs: loop.leaseMs,
        $expiresAt: loop.expiresAt ?? null,
        $expiresAfterRuns: loop.expiresAfterRuns ?? null,
        $created: loop.createdAt,
        $updated: loop.updatedAt,
      });
    return loop;
  }

  getLoop(id: string): Loop | undefined {
    const row = this.db.query<LoopRow, [string]>("SELECT * FROM loops WHERE id = ?").get(id);
    return row ? rowToLoop(row) : undefined;
  }

  findLoopByName(name: string): Loop | undefined {
    const row = this.db.query<LoopRow, [string]>("SELECT * FROM loops WHERE name = ? ORDER BY created_at DESC LIMIT 1").get(name);
    return row ? rowToLoop(row) : undefined;
  }

  requireUniqueLoop(idOrName: string): Loop {
    const byId = this.getLoop(idOrName);
    if (byId) return byId;
    // Resolve by name WITHOUT filtering archived loops, so a uniquely-named
    // archived loop still resolves (downstream reports "loop is archived" rather
    // than "loop not found").
    const rows = this.db
      .query<LoopRow, [string]>("SELECT * FROM loops WHERE name = ? ORDER BY created_at DESC LIMIT 2")
      .all(idOrName);
    if (rows.length === 0) throw new LoopNotFoundError(idOrName);
    if (rows.length === 1) return rowToLoop(rows[0]!);
    // Multiple namesakes: archived loops must not count toward ambiguity, so
    // prefer the sole active one (a rename on archive is not enforced). Ambiguity
    // only holds when 2+ ACTIVE loops share the name.
    const active = this.db
      .query<LoopRow, [string]>("SELECT * FROM loops WHERE name = ? AND archived_at IS NULL ORDER BY created_at DESC LIMIT 2")
      .all(idOrName);
    if (active.length !== 1) throw new AmbiguousNameError(idOrName);
    return rowToLoop(active[0]!);
  }

  private requireArchiveMutationLoop(idOrName: string, operation: "archive" | "unarchive"): Loop {
    const byId = this.getLoop(idOrName);
    if (byId) return byId;
    const eligibleWhere = operation === "archive" ? "archived_at IS NULL" : "archived_at IS NOT NULL";
    const eligible = this.db
      .query<LoopRow, [string]>(
        `SELECT * FROM loops WHERE name = ? AND ${eligibleWhere} ORDER BY created_at DESC LIMIT 2`,
      )
      .all(idOrName);
    if (eligible.length > 1) throw new AmbiguousNameError(idOrName);
    if (eligible.length === 1) return rowToLoop(eligible[0]!);

    // Preserve idempotence for a uniquely named loop already in the requested
    // state. Multiple same-state rows still fail closed because a name cannot
    // identify which exact row the caller previously targeted.
    const alreadyWhere = operation === "archive" ? "archived_at IS NOT NULL" : "archived_at IS NULL";
    const already = this.db
      .query<LoopRow, [string]>(
        `SELECT * FROM loops WHERE name = ? AND ${alreadyWhere} ORDER BY created_at DESC LIMIT 2`,
      )
      .all(idOrName);
    if (already.length === 0) throw new LoopNotFoundError(idOrName);
    if (already.length > 1) throw new AmbiguousNameError(idOrName);
    return rowToLoop(already[0]!);
  }

  requireLoop(idOrName: string): Loop {
    return this.getLoop(idOrName) ?? this.findLoopByName(idOrName) ?? (() => {
      throw new LoopNotFoundError(idOrName);
    })();
  }

  listLoops(opts: { status?: LoopStatus; labels?: string[]; limit?: number; offset?: number; archived?: boolean; includeArchived?: boolean; name?: string } = {}): Loop[] {
    const limit = opts.limit ?? 200;
    const offset = Math.max(0, Math.floor(opts.offset ?? 0));
    // Exact-name lookup short-circuits every other filter: it returns *all*
    // loops (archived included) matching the name so callers can detect
    // ambiguity, mirroring findLoopByName plus the resolveLoop resolution path.
    if (opts.name != null) {
      const rows = this.db
        .query<LoopRow, [string, number, number]>("SELECT * FROM loops WHERE name = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?")
        .all(opts.name, limit, offset);
      return this.withLatestRunSummaries(rows.map(rowToLoop));
    }
    const labels = normalizeLoopLabels(opts.labels);
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (opts.status) {
      where.push("loops.status = ?");
      params.push(opts.status);
    }
    if (opts.archived) where.push("loops.archived_at IS NOT NULL");
    else if (!opts.includeArchived) where.push("loops.archived_at IS NULL");
    for (const label of labels) {
      where.push("EXISTS (SELECT 1 FROM json_each(loops.labels_json) WHERE value = ?)");
      params.push(label);
    }
    const order = opts.archived
      ? "loops.archived_at DESC, loops.id DESC"
      : "loops.status ASC, loops.next_run_at ASC, loops.id ASC";
    const rows = this.db
      .query<LoopRow, Array<string | number>>(
        `SELECT loops.* FROM loops${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY ${order} LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);
    return this.withLatestRunSummaries(rows.map(rowToLoop));
  }

  private withLatestRunSummaries(loops: Loop[]): Loop[] {
    if (loops.length === 0) return loops;
    const placeholders = loops.map(() => "?").join(",");
    const rows = this.db
      .query<LatestRunSummaryRow, string[]>(
        `SELECT loop_id, id, status, started_at, finished_at, created_at
         FROM (
           SELECT loop_id, id, status, started_at, finished_at, created_at,
             ROW_NUMBER() OVER (PARTITION BY loop_id ORDER BY created_at DESC, id DESC) AS rn
           FROM loop_runs
           WHERE loop_id IN (${placeholders})
         )
         WHERE rn = 1`,
      )
      .all(...loops.map((loop) => loop.id));
    const latestByLoopId = new Map(rows.map((row) => [row.loop_id, row]));
    return loops.map((loop) => {
      const latest = latestByLoopId.get(loop.id);
      if (!latest) return loop;
      return {
        ...loop,
        latestRunId: latest.id,
        latestRunStatus: latest.status as RunStatus,
        lastRunAt: latestRunTime(latest),
      };
    });
  }

  dueLoops(now: Date, limit = 500): Loop[] {
    const rows = this.db
      .query<LoopRow, [string, number]>(
        `SELECT * FROM loops
         WHERE status = 'active'
           AND archived_at IS NULL
           AND next_run_at IS NOT NULL
           AND next_run_at <= ?
         ORDER BY next_run_at ASC
         LIMIT ?`,
      )
      .all(now.toISOString(), limit);
    return rows.map(rowToLoop);
  }

  updateLoop(
    id: string,
    patch: Partial<Pick<Loop, "status" | "nextRunAt" | "retryScheduledFor" | "expiresAt" | "expiresAfterRuns" | "labels" | "maxAttempts" | "leaseMs">>,
    opts: DaemonLeaseFence = {},
  ): Loop {
    const updated = (opts.now ?? new Date()).toISOString();
    if ("status" in patch && patch.status !== undefined) assertLoopStatus(patch.status);
    if ("maxAttempts" in patch && patch.maxAttempts !== undefined) assertMaxAttempts(patch.maxAttempts);
    if ("expiresAfterRuns" in patch && patch.expiresAfterRuns !== undefined) assertExpiresAfterRuns(patch.expiresAfterRuns);
    if ("leaseMs" in patch && patch.leaseMs !== undefined) assertLeaseMs(patch.leaseMs);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.getLoop(id);
      if (!current) throw new LoopNotFoundError(id);
      // Archived loops are frozen: the explicit unarchive mutation path is
      // unarchiveLoop(), which restores status directly.
      if (current.archivedAt) throw new LoopArchivedError(current.name || id);
      const merged: Loop = {
        ...current,
        ...patch,
        labels: patch.labels !== undefined ? normalizeLoopLabels(patch.labels) : current.labels,
        updatedAt: updated,
      };
      const res = this.db
        .query(
          `UPDATE loops SET status=$status, labels_json=$labels, next_run_at=$nextRun, retry_scheduled_for=$retrySlot,
           expires_at=$expiresAt, expires_after_runs=$expiresAfterRuns, max_attempts=$maxAttempts, lease_ms=$leaseMs, updated_at=$updated
           WHERE id=$id
             AND ($daemonLeaseId IS NULL OR EXISTS (
               SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
             ))`,
        )
        .run({
          $id: id,
          $status: merged.status,
          $labels: JSON.stringify(merged.labels),
          $nextRun: merged.nextRunAt ?? null,
          $retrySlot: merged.retryScheduledFor ?? null,
          $expiresAt: merged.expiresAt ?? null,
          $expiresAfterRuns: merged.expiresAfterRuns ?? null,
          $maxAttempts: merged.maxAttempts,
          $leaseMs: merged.leaseMs,
          $updated: merged.updatedAt,
          $daemonLeaseId: opts.daemonLeaseId ?? null,
          $now: updated,
        });
      if (res.changes !== 1) throw new Error("daemon lease lost");
      if (patch.status && patch.status !== "active") {
        const status: WorkflowWorkItemStatus = patch.status === "paused" ? "deferred" : "cancelled";
        this.setWorkflowWorkItemsForLoop(id, status, `loop ${patch.status}`, updated);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      throw error;
    }
    const after = this.getLoop(id);
    if (!after) throw new Error(`loop not found after update: ${id}`);
    return after;
  }

  mutateLoop(
    envelope: LoopMutationEnvelope,
    authority: OperationAuthorityBinding,
    opts: { now?: Date; leaseMs?: number } = {},
  ): LoopMutationResult {
    const binding = normalizeLoopMutationEnvelope(envelope, authority);
    const now = opts.now ?? new Date();
    const createdAt = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + (opts.leaseMs ?? 30_000)).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db.query<{
        binding_digest: string;
        binding_json: string;
        admission_json: string;
        terminal_json: string;
        result_json: string;
      }, [string, string, string]>(
        `SELECT binding_digest, binding_json, admission_json, terminal_json, result_json
         FROM loop_mutation_operations
         WHERE tenant_id=? AND operation_id=? AND step_id=?`,
      ).get(binding.authority.tenantId, binding.operationId, binding.stepId);
      if (existing) {
        if (existing.binding_digest !== binding.bindingDigest) {
          throw new LoopMutationConflictError("binding_mismatch", binding.targetId);
        }
        this.db.exec("COMMIT");
        return {
          binding,
          admission: JSON.parse(existing.admission_json),
          terminal: JSON.parse(existing.terminal_json),
          loop: JSON.parse(existing.result_json),
          replayed: true,
        } as LoopMutationResult;
      }

      const current = this.getLoop(binding.targetId);
      if (!current) throw new LoopNotFoundError(binding.targetId);
      if (current.archivedAt) throw new LoopArchivedError(current.name || current.id);
      if (current.updatedAt !== binding.expectedRevision) {
        throw new LoopMutationConflictError("revision_mismatch", binding.targetId);
      }

      this.db.query("DELETE FROM loop_mutation_leases WHERE tenant_id=? AND target_id=? AND expires_at <= ?")
        .run(binding.authority.tenantId, binding.targetId, createdAt);
      try {
        this.db.query(
          `INSERT INTO loop_mutation_leases
           (tenant_id,target_id,lease_id,operation_id,step_id,expires_at,created_at)
           VALUES (?,?,?,?,?,?,?)`,
        ).run(
          binding.authority.tenantId,
          binding.targetId,
          binding.leaseId,
          binding.operationId,
          binding.stepId,
          leaseExpiresAt,
          createdAt,
        );
      } catch {
        throw new LoopMutationConflictError("lease_conflict", binding.targetId);
      }

      let result = current;
      if (!binding.dryRun) {
        const status: LoopStatus = binding.action === "pause"
          ? "paused"
          : binding.action === "stop"
            ? "stopped"
            : "active";
        const nextRunAt = binding.action === "stop"
          ? undefined
          : binding.action === "resume" && !current.nextRunAt
            ? initialNextRun(current.schedule, now)
            : current.nextRunAt;
        const updatedAt = new Date(Math.max(now.getTime(), Date.parse(current.updatedAt) + 1)).toISOString();
        const update = this.db.query(
          `UPDATE loops SET status=?, next_run_at=?, updated_at=?
           WHERE id=? AND updated_at=? AND archived_at IS NULL`,
        ).run(status, nextRunAt ?? null, updatedAt, current.id, binding.expectedRevision);
        if (update.changes !== 1) throw new LoopMutationConflictError("revision_mismatch", binding.targetId);
        if (status !== "active") {
          this.setWorkflowWorkItemsForLoop(
            current.id,
            status === "paused" ? "deferred" : "cancelled",
            `loop ${status}`,
            updatedAt,
          );
        }
        result = { ...current, status, nextRunAt, updatedAt };
      }
      const admission = loopMutationAdmissionReceipt(binding, createdAt);
      const terminal = loopMutationTerminalReceipt(binding, result, createdAt);
      this.db.query(
        `INSERT INTO loop_mutation_operations
         (tenant_id,operation_id,step_id,target_id,binding_digest,binding_json,admission_json,terminal_json,result_json,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        binding.authority.tenantId,
        binding.operationId,
        binding.stepId,
        binding.targetId,
        binding.bindingDigest,
        JSON.stringify(binding),
        JSON.stringify(admission),
        JSON.stringify(terminal),
        JSON.stringify(result),
        createdAt,
      );
      this.db.query("DELETE FROM loop_mutation_leases WHERE tenant_id=? AND target_id=? AND lease_id=?")
        .run(binding.authority.tenantId, binding.targetId, binding.leaseId);
      this.db.exec("COMMIT");
      return { binding, admission, terminal, loop: result, replayed: false };
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      throw error;
    }
  }

  getLoopMutationResult(
    authority: OperationAuthorityBinding,
    operationId: string,
    stepId: string,
    caps: LoopMutationLookupCaps = DEFAULT_LOOP_MUTATION_LOOKUP_CAPS,
  ): LoopMutationResult | undefined {
    const startedAt = Date.now();
    if (!Number.isInteger(caps.maxCalls) || caps.maxCalls < 1) throw new ValidationError("loop mutation lookup call cap exceeded");
    if (!Number.isInteger(caps.maxRecords) || caps.maxRecords < 1) throw new ValidationError("loop mutation lookup record cap exceeded");
    if (!Number.isInteger(caps.maxBytes) || caps.maxBytes < 1) throw new ValidationError("loop mutation lookup byte cap exceeded");
    if (!Number.isInteger(caps.maxWallMs) || caps.maxWallMs < 1) throw new ValidationError("loop mutation lookup wall-time cap exceeded");
    const rows = this.db.query<{
      binding_digest: string;
      binding_json: string;
      admission_json: string;
      terminal_json: string;
      result_json: string;
    }, [string, string, string]>(
      `SELECT binding_digest, binding_json, admission_json, terminal_json, result_json
       FROM loop_mutation_operations
       WHERE tenant_id=? AND operation_id=? AND step_id=?
       LIMIT 2`,
    ).all(authority.tenantId, operationId, stepId);
    if (rows.length > caps.maxRecords) throw new ValidationError("loop mutation lookup record cap exceeded");
    if (Date.now() - startedAt > caps.maxWallMs) throw new ValidationError("loop mutation lookup wall-time cap exceeded");
    if (rows.length === 0) return undefined;
    if (rows.length !== 1) throw new ValidationError("duplicate loop mutation result");
    const row = rows[0]!;
    const bytes = Buffer.byteLength(row.binding_json) + Buffer.byteLength(row.admission_json) +
      Buffer.byteLength(row.terminal_json) + Buffer.byteLength(row.result_json);
    if (bytes > caps.maxBytes) throw new ValidationError("loop mutation lookup byte cap exceeded");
    const binding = JSON.parse(row.binding_json);
    const admission = JSON.parse(row.admission_json);
    const terminal = JSON.parse(row.terminal_json);
    const loop = JSON.parse(row.result_json);
    if (
      binding.bindingDigest !== row.binding_digest ||
      admission.bindingDigest !== row.binding_digest ||
      terminal.bindingDigest !== row.binding_digest
    ) {
      throw new LoopMutationConflictError("binding_mismatch", admission.targetId);
    }
    return { binding, admission, terminal, loop, replayed: true };
  }

  advanceLoopIfCurrent(
    id: string,
    expected: LoopSchedulingState,
    patch: Partial<Pick<Loop, "status" | "nextRunAt" | "retryScheduledFor">>,
    opts: DaemonLeaseFence = {},
  ): Loop | undefined {
    const updated = (opts.now ?? new Date()).toISOString();
    if ("status" in patch && patch.status !== undefined) assertLoopStatus(patch.status);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.getLoop(id);
      if (!current || current.archivedAt) {
        this.db.exec("COMMIT");
        return undefined;
      }
      if (
        current.status !== expected.status ||
        current.nextRunAt !== expected.nextRunAt ||
        current.retryScheduledFor !== expected.retryScheduledFor
      ) {
        this.db.exec("COMMIT");
        return undefined;
      }
      if (opts.recoveredRun) {
        const run = this.getRun(opts.recoveredRun.id);
        if (
          !run ||
          run.status !== "abandoned" ||
          run.error !== "run lease expired before completion" ||
          run.attempt !== opts.recoveredRun.attempt ||
          run.updatedAt !== opts.recoveredRun.updatedAt ||
          run.scheduledFor !== opts.recoveredRun.scheduledFor
        ) {
          this.db.exec("COMMIT");
          return undefined;
        }
      }
      const merged: Loop = { ...current, ...patch, updatedAt: updated };
      const res = this.db
        .query(
          `UPDATE loops SET status=$status, next_run_at=$nextRun, retry_scheduled_for=$retrySlot, updated_at=$updated
           WHERE id=$id
             AND archived_at IS NULL
             AND status=$expectedStatus
             AND next_run_at IS $expectedNextRun
             AND retry_scheduled_for IS $expectedRetrySlot
             AND ($daemonLeaseId IS NULL OR EXISTS (
               SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
             ))`,
        )
        .run({
          $id: id,
          $status: merged.status,
          $nextRun: merged.nextRunAt ?? null,
          $retrySlot: merged.retryScheduledFor ?? null,
          $updated: updated,
          $expectedStatus: expected.status,
          $expectedNextRun: expected.nextRunAt ?? null,
          $expectedRetrySlot: expected.retryScheduledFor ?? null,
          $daemonLeaseId: opts.daemonLeaseId ?? null,
          $now: updated,
        });
      if (res.changes !== 1) {
        this.db.exec("COMMIT");
        return undefined;
      }
      if (patch.status && patch.status !== "active") {
        const status: WorkflowWorkItemStatus = patch.status === "paused" ? "deferred" : "cancelled";
        this.setWorkflowWorkItemsForLoop(id, status, `loop ${patch.status}`, updated);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      throw error;
    }
    return this.getLoop(id);
  }

  tripCircuitBreakerIfCurrent(
    id: string,
    expected: LoopSchedulingState,
    patch: Partial<Pick<Loop, "status" | "nextRunAt" | "retryScheduledFor">>,
    marker: { scheduledFor: string; reason: string },
    opts: DaemonLeaseFence = {},
  ): CircuitBreakerTransitionResult | undefined {
    const updated = (opts.now ?? new Date()).toISOString();
    const scrubbedReason = scrubbedOrNull(marker.reason) ?? "";
    if ("status" in patch && patch.status !== undefined) assertLoopStatus(patch.status);
    this.db.exec("BEGIN IMMEDIATE");
    let markerScheduledFor = marker.scheduledFor;
    try {
      const current = this.getLoop(id);
      if (
        !current ||
        current.archivedAt ||
        current.status !== expected.status ||
        current.nextRunAt !== expected.nextRunAt ||
        current.retryScheduledFor !== expected.retryScheduledFor
      ) {
        this.db.exec("COMMIT");
        return undefined;
      }
      if (opts.recoveredRun) {
        const run = this.getRun(opts.recoveredRun.id);
        if (
          !run ||
          run.status !== "abandoned" ||
          run.error !== "run lease expired before completion" ||
          run.attempt !== opts.recoveredRun.attempt ||
          run.updatedAt !== opts.recoveredRun.updatedAt ||
          run.scheduledFor !== opts.recoveredRun.scheduledFor
        ) {
          this.db.exec("COMMIT");
          return undefined;
        }
      }
      const merged: Loop = { ...current, ...patch, updatedAt: updated };
      const res = this.db
        .query(
          `UPDATE loops SET status=$status, next_run_at=$nextRun, retry_scheduled_for=$retrySlot, updated_at=$updated
           WHERE id=$id
             AND archived_at IS NULL
             AND status=$expectedStatus
             AND next_run_at IS $expectedNextRun
             AND retry_scheduled_for IS $expectedRetrySlot
             AND ($daemonLeaseId IS NULL OR EXISTS (
               SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
             ))`,
        )
        .run({
          $id: id,
          $status: merged.status,
          $nextRun: merged.nextRunAt ?? null,
          $retrySlot: merged.retryScheduledFor ?? null,
          $updated: updated,
          $expectedStatus: expected.status,
          $expectedNextRun: expected.nextRunAt ?? null,
          $expectedRetrySlot: expected.retryScheduledFor ?? null,
          $daemonLeaseId: opts.daemonLeaseId ?? null,
          $now: updated,
        });
      if (res.changes !== 1) {
        this.db.exec("COMMIT");
        return undefined;
      }
      let markerAtMs = new Date(markerScheduledFor).getTime();
      for (let probe = 0; probe < 1_000 && this.getRunBySlot(id, new Date(markerAtMs).toISOString()); probe += 1) {
        markerAtMs += 1;
      }
      markerScheduledFor = new Date(markerAtMs).toISOString();
      const markerId = genId();
      this.db
        .query(
          `INSERT INTO loop_runs (id, loop_id, loop_name, scheduled_for, attempt, status, started_at, finished_at,
            claimed_by, lease_expires_at, pid, exit_code, duration_ms, stdout, stderr, error, created_at, updated_at)
           VALUES ($id, $loopId, $loopName, $scheduledFor, 1, 'skipped', NULL, $finished, NULL, NULL, NULL, NULL, NULL,
            NULL, NULL, $error, $created, $updated)`,
        )
        .run({
          $id: markerId,
          $loopId: current.id,
          $loopName: current.name,
          $scheduledFor: markerScheduledFor,
          $finished: updated,
          $error: scrubbedReason,
          $created: updated,
          $updated: updated,
        });
      if (patch.status && patch.status !== "active") {
        const status: WorkflowWorkItemStatus = patch.status === "paused" ? "deferred" : "cancelled";
        this.setWorkflowWorkItemsForLoop(id, status, `loop ${patch.status}`, updated);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      throw error;
    }
    const loop = this.getLoop(id);
    const createdMarker = this.getRunBySlot(id, markerScheduledFor);
    if (!loop || !createdMarker) throw new Error(`circuit breaker transition missing committed rows: ${id}`);
    return { loop, marker: createdMarker };
  }

  private activeLoopReferenceCount(workflowId: string): number {
    const rows = this.db.query<{ target_json: string }, []>("SELECT target_json FROM loops WHERE archived_at IS NULL").all();
    let count = 0;
    for (const row of rows) {
      try {
        const target = JSON.parse(row.target_json) as Loop["target"];
        if (target.type === "workflow" && target.workflowId === workflowId) count += 1;
      } catch {
        /* invalid target JSON is handled elsewhere by normal store reads */
      }
    }
    return count;
  }

  private archiveWorkflowIfUnreferenced(workflowId: string, updated: string): WorkflowSpec | undefined {
    if (this.activeLoopReferenceCount(workflowId) > 0) return undefined;
    const workflow = this.getWorkflow(workflowId);
    if (!workflow || workflow.status !== "active") return undefined;
    const res = this.db
      .query("UPDATE workflow_specs SET status='archived', updated_at=? WHERE id=? AND status='active'")
      .run(updated, workflowId);
    if (res.changes !== 1) return undefined;
    return this.getWorkflow(workflowId);
  }

  retargetWorkflowLoop(idOrName: string, workflowId: string, opts: DaemonLeaseFence & { workflowTimeoutMs?: TimeoutMs } = {}): Loop {
    const updated = (opts.now ?? new Date()).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.requireLoop(idOrName);
      if (current.target.type !== "workflow") throw new Error(`loop is not a workflow loop: ${idOrName}`);
      if (this.hasRunningRun(current.id)) throw new Error(`refusing to retarget running loop: ${current.id}`);
      const workflow = this.requireWorkflow(workflowId);
      if (current.goal && workflow.goal) {
        throw new Error(
          `workflow loop cannot retarget ${current.name} to workflow ${workflow.name} because both define top-level goals`,
        );
      }
      const target = { ...current.target, workflowId: workflow.id };
      if (opts.workflowTimeoutMs !== undefined) target.timeoutMs = opts.workflowTimeoutMs;
      const res = this.db
        .query(
          `UPDATE loops SET target_json=$target, updated_at=$updated
           WHERE id=$id
             AND ($daemonLeaseId IS NULL OR EXISTS (
               SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
             ))`,
        )
        .run({
          $id: current.id,
          $target: JSON.stringify(target),
          $updated: updated,
          $daemonLeaseId: opts.daemonLeaseId ?? null,
          $now: updated,
        });
      if (res.changes !== 1) throw new Error("daemon lease lost");
      this.db.exec("COMMIT");
      const after = this.getLoop(current.id);
      if (!after) throw new Error(`loop not found after retarget: ${current.id}`);
      return after;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      throw error;
    }
  }

  updateAgentLoopTimeout(idOrName: string, timeoutMs: TimeoutMs, opts: DaemonLeaseFence = {}): Loop {
    const updated = (opts.now ?? new Date()).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.requireUniqueLoop(idOrName);
      if (current.archivedAt) throw new LoopArchivedError(current.name || current.id);
      if (current.target.type !== "agent") throw new Error(`loop is not an agent loop: ${idOrName}`);
      if (this.hasRunningRun(current.id)) throw new Error(`refusing to update running loop: ${current.id}`);
      const target = { ...current.target, timeoutMs };
      if (timeoutMs === null && target.idleTimeoutMs !== undefined) delete target.idleTimeoutMs;
      const res = this.db
        .query(
          `UPDATE loops SET target_json=$target, updated_at=$updated
           WHERE id=$id
             AND ($daemonLeaseId IS NULL OR EXISTS (
               SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
             ))`,
        )
        .run({
          $id: current.id,
          $target: JSON.stringify(target),
          $updated: updated,
          $daemonLeaseId: opts.daemonLeaseId ?? null,
          $now: updated,
        });
      if (res.changes !== 1) throw new Error("daemon lease lost");
      this.db.exec("COMMIT");
      const after = this.getLoop(current.id);
      if (!after) throw new Error(`loop not found after timeout update: ${current.id}`);
      return after;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      throw error;
    }
  }

  createAndRetargetWorkflowLoop(
    idOrName: string,
    workflowInput: CreateWorkflowInput,
    opts: DaemonLeaseFence & { workflowTimeoutMs?: TimeoutMs; archiveOld?: boolean } = {},
  ): { loop: Loop; workflow: WorkflowSpec; previousWorkflow: WorkflowSpec; archivedOld?: WorkflowSpec } {
    const normalized = normalizeCreateWorkflowInput(workflowInput);
    const updated = (opts.now ?? new Date()).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.requireUniqueLoop(idOrName);
      if (current.target.type !== "workflow") throw new Error(`loop is not a workflow loop: ${idOrName}`);
      if (this.hasRunningRun(current.id)) throw new Error(`refusing to retarget running loop: ${current.id}`);
      if (current.goal && normalized.goal) {
        throw new Error(
          `workflow loop cannot retarget ${current.name} to a workflow that also defines a top-level goal`,
        );
      }
      const previousWorkflow = this.requireWorkflow(current.target.workflowId);
      const workflow: WorkflowSpec = {
        id: genId(),
        name: normalized.name,
        description: normalized.description,
        version: normalized.version ?? 1,
        status: "active",
        goal: normalized.goal,
        steps: normalized.steps,
        createdAt: updated,
        updatedAt: updated,
      };
      this.db
        .query(
          `INSERT INTO workflow_specs (id, name, description, version, status, goal_json, steps_json, created_at, updated_at)
           VALUES ($id, $name, $description, $version, $status, $goal, $steps, $created, $updated)`,
        )
        .run({
          $id: workflow.id,
          $name: workflow.name,
          $description: workflow.description ?? null,
          $version: workflow.version,
          $status: workflow.status,
          $goal: workflow.goal ? JSON.stringify(workflow.goal) : null,
          $steps: JSON.stringify(workflow.steps),
          $created: workflow.createdAt,
          $updated: workflow.updatedAt,
        });
      const target = { ...current.target, workflowId: workflow.id };
      if (opts.workflowTimeoutMs !== undefined) target.timeoutMs = opts.workflowTimeoutMs;
      const res = this.db
        .query(
          `UPDATE loops SET target_json=$target, updated_at=$updated
           WHERE id=$id
             AND ($daemonLeaseId IS NULL OR EXISTS (
               SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
             ))`,
        )
        .run({
          $id: current.id,
          $target: JSON.stringify(target),
          $updated: updated,
          $daemonLeaseId: opts.daemonLeaseId ?? null,
          $now: updated,
        });
      if (res.changes !== 1) throw new Error("daemon lease lost");
      const archivedOld = opts.archiveOld ? this.archiveWorkflowIfUnreferenced(previousWorkflow.id, updated) : undefined;
      this.db.exec("COMMIT");
      const loop = this.getLoop(current.id);
      if (!loop) throw new Error(`loop not found after retarget: ${current.id}`);
      return { loop, workflow, previousWorkflow, archivedOld };
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      throw error;
    }
  }

  cloneWorkflowWithoutGoalAndRetargetLoop(
    idOrName: string,
    opts: DaemonLeaseFence & { workflowName: string; workflowTimeoutMs?: TimeoutMs; archiveOld?: boolean },
  ): { loop: Loop; workflow: WorkflowSpec; previousWorkflow: WorkflowSpec; archivedOld?: WorkflowSpec } {
    const updated = (opts.now ?? new Date()).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.requireUniqueLoop(idOrName);
      if (current.target.type !== "workflow") throw new Error(`loop is not a workflow loop: ${idOrName}`);
      if (this.hasRunningRun(current.id)) throw new Error(`refusing to retarget running loop: ${current.id}`);
      if (!current.goal) throw new Error(`workflow loop ${current.name} has no loop-level goal wrapper`);
      const previousWorkflow = this.requireWorkflow(current.target.workflowId);
      if (!previousWorkflow.goal) throw new Error(`workflow ${previousWorkflow.name} has no top-level goal wrapper`);
      const workflow: WorkflowSpec = {
        id: genId(),
        name: opts.workflowName,
        description: previousWorkflow.description,
        version: previousWorkflow.version,
        status: "active",
        steps: previousWorkflow.steps,
        createdAt: updated,
        updatedAt: updated,
      };
      this.db
        .query(
          `INSERT INTO workflow_specs (id, name, description, version, status, goal_json, steps_json, created_at, updated_at)
           VALUES ($id, $name, $description, $version, $status, NULL, $steps, $created, $updated)`,
        )
        .run({
          $id: workflow.id,
          $name: workflow.name,
          $description: workflow.description ?? null,
          $version: workflow.version,
          $status: workflow.status,
          $steps: JSON.stringify(workflow.steps),
          $created: workflow.createdAt,
          $updated: workflow.updatedAt,
        });
      const target = { ...current.target, workflowId: workflow.id };
      if (opts.workflowTimeoutMs !== undefined) target.timeoutMs = opts.workflowTimeoutMs;
      const res = this.db
        .query(
          `UPDATE loops SET target_json=$target, updated_at=$updated
           WHERE id=$id
             AND ($daemonLeaseId IS NULL OR EXISTS (
               SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
             ))`,
        )
        .run({
          $id: current.id,
          $target: JSON.stringify(target),
          $updated: updated,
          $daemonLeaseId: opts.daemonLeaseId ?? null,
          $now: updated,
        });
      if (res.changes !== 1) throw new Error("daemon lease lost");
      const archivedOld = opts.archiveOld ? this.archiveWorkflowIfUnreferenced(previousWorkflow.id, updated) : undefined;
      this.db.exec("COMMIT");
      const loop = this.getLoop(current.id);
      if (!loop) throw new Error(`loop not found after retarget: ${current.id}`);
      return { loop, workflow, previousWorkflow, archivedOld };
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      throw error;
    }
  }

  renameLoop(id: string, name: string, opts: DaemonLeaseFence = {}): Loop {
    const current = this.getLoop(id);
    if (!current) throw new LoopNotFoundError(id);
    const trimmed = name.trim();
    if (!trimmed) throw new ValidationError("loop name must not be empty");
    const updated = (opts.now ?? new Date()).toISOString();
    this.db
      .query(
        `UPDATE loops SET name=$name, updated_at=$updated
         WHERE id=$id
           AND ($daemonLeaseId IS NULL OR EXISTS (
             SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
           ))`,
      )
      .run({
        $id: id,
        $name: trimmed,
        $updated: updated,
        $daemonLeaseId: opts.daemonLeaseId ?? null,
        $now: updated,
      });
    const after = this.getLoop(id);
    if (!after) throw new Error(`loop not found after rename: ${id}`);
    return after;
  }

  archiveLoop(idOrName: string): Loop {
    return this.transact(() => {
      const loop = this.requireArchiveMutationLoop(idOrName, "archive");
      if (loop.archivedAt) return loop;
      const updated = nowIso();
      const archivedStatus: LoopStatus = loop.status === "active" ? "paused" : loop.status;
      this.db
        .query(
          `UPDATE loops
           SET status=$status, archived_at=$archivedAt, archived_from_status=$archivedFromStatus, updated_at=$updated
           WHERE id=$id`,
        )
        .run({
          $id: loop.id,
          $status: archivedStatus,
          $archivedAt: updated,
          $archivedFromStatus: loop.status,
          $updated: updated,
        });
      this.setWorkflowWorkItemsForLoop(loop.id, "deferred", "loop archived", updated);
      const archived = this.getLoop(loop.id);
      if (!archived) throw new Error(`loop not found after archive: ${loop.id}`);
      return archived;
    });
  }

  unarchiveLoop(idOrName: string): Loop {
    return this.transact(() => {
      const loop = this.requireArchiveMutationLoop(idOrName, "unarchive");
      if (!loop.archivedAt) return loop;
      const updated = nowIso();
      const restoredStatus = loop.archivedFromStatus ?? loop.status;
      this.db
        .query(
          `UPDATE loops
           SET status=$status, archived_at=NULL, archived_from_status=NULL, updated_at=$updated
           WHERE id=$id`,
        )
        .run({
          $id: loop.id,
          $status: restoredStatus,
          $updated: updated,
        });
      const unarchived = this.getLoop(loop.id);
      if (!unarchived) throw new Error(`loop not found after unarchive: ${loop.id}`);
      return unarchived;
    });
  }

  deleteLoop(idOrName: string): boolean {
    return this.transact(() => {
      const loop = this.requireLoop(idOrName);
      this.setWorkflowWorkItemsForLoop(loop.id, "cancelled", "loop deleted", nowIso());
      // Unlike postgres (loop_runs.loop_id REFERENCES loops ON DELETE CASCADE),
      // the sqlite loop_runs table declares no FK to loops, so deleting the loop
      // alone orphans its run history — including still-"running" rows that keep
      // inflating daemonStatus.runs.running forever. Delete children explicitly
      // (a table rebuild to add the FK to existing data is riskier). The FK
      // workflow_runs.loop_run_id ON DELETE SET NULL then nulls dangling refs.
      this.db.query("DELETE FROM loop_runs WHERE loop_id = ?").run(loop.id);
      const res = this.db.query("DELETE FROM loops WHERE id = ?").run(loop.id);
      return res.changes > 0;
    });
  }

  createWorkflow(input: CreateWorkflowInput): WorkflowSpec {
    const normalized = normalizeCreateWorkflowInput(input);
    const now = nowIso();
    const workflow: WorkflowSpec = {
      id: genId(),
      name: normalized.name,
      description: normalized.description,
      version: normalized.version ?? 1,
      status: "active",
      goal: normalized.goal,
      steps: normalized.steps,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .query(
        `INSERT INTO workflow_specs (id, name, description, version, status, goal_json, steps_json, created_at, updated_at)
         VALUES ($id, $name, $description, $version, $status, $goal, $steps, $created, $updated)`,
      )
      .run({
        $id: workflow.id,
        $name: workflow.name,
        $description: workflow.description ?? null,
        $version: workflow.version,
        $status: workflow.status,
        $goal: workflow.goal ? JSON.stringify(workflow.goal) : null,
        $steps: JSON.stringify(workflow.steps),
        $created: workflow.createdAt,
        $updated: workflow.updatedAt,
      });
    return workflow;
  }

  getWorkflow(id: string): WorkflowSpec | undefined {
    const row = this.db.query<WorkflowRow, [string]>("SELECT * FROM workflow_specs WHERE id = ?").get(id);
    return row ? rowToWorkflow(row) : undefined;
  }

  findWorkflowByName(name: string): WorkflowSpec | undefined {
    const row = this.db
      .query<WorkflowRow, [string]>(
        "SELECT * FROM workflow_specs WHERE name = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 1",
      )
      .get(name);
    return row ? rowToWorkflow(row) : undefined;
  }

  requireWorkflow(idOrName: string): WorkflowSpec {
    return this.getWorkflow(idOrName) ?? this.findWorkflowByName(idOrName) ?? (() => {
      throw new Error(`workflow not found: ${idOrName}`);
    })();
  }

  listWorkflows(opts: { status?: WorkflowSpec["status"]; limit?: number; offset?: number } = {}): WorkflowSpec[] {
    const offset = Math.max(0, opts.offset ?? 0);
    let rows: WorkflowRow[];
    if (opts.status && opts.limit !== undefined) {
      rows = this.db
        .query<WorkflowRow, [string, number, number]>(
          "SELECT * FROM workflow_specs WHERE status = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?",
        )
        .all(opts.status, opts.limit, offset);
    } else if (opts.status) {
      rows = this.db
        .query<WorkflowRow, [string, number]>("SELECT * FROM workflow_specs WHERE status = ? ORDER BY updated_at DESC LIMIT -1 OFFSET ?")
        .all(opts.status, offset);
    } else if (opts.limit !== undefined) {
      rows = this.db
        .query<WorkflowRow, [number, number]>("SELECT * FROM workflow_specs ORDER BY status ASC, updated_at DESC LIMIT ? OFFSET ?")
        .all(opts.limit, offset);
    } else {
      rows = this.db
        .query<WorkflowRow, [number]>("SELECT * FROM workflow_specs ORDER BY status ASC, updated_at DESC LIMIT -1 OFFSET ?")
        .all(offset);
    }
    return rows.map(rowToWorkflow);
  }

  countWorkflows(opts: { status?: WorkflowSpec["status"] } = {}): number {
    const row = opts.status
      ? this.db.query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM workflow_specs WHERE status = ?").get(opts.status)
      : this.db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM workflow_specs").get();
    return row?.count ?? 0;
  }

  archiveWorkflow(idOrName: string): WorkflowSpec {
    const workflow = this.requireWorkflow(idOrName);
    const updated = nowIso();
    this.db
      .query("UPDATE workflow_specs SET status='archived', updated_at=? WHERE id=?")
      .run(updated, workflow.id);
    const archived = this.getWorkflow(workflow.id);
    if (!archived) throw new Error(`workflow not found after archive: ${workflow.id}`);
    return archived;
  }

  private generatedRouteArchiveContext(args: { workflowId: string; loopId?: string; workItemId?: string }) {
    if (!args.loopId || !args.workItemId) return undefined;
    const workItem = this.getWorkflowWorkItem(args.workItemId);
    if (!workItem || !GENERATED_ROUTE_KEYS.has(workItem.routeKey)) return undefined;
    const invocation = this.getWorkflowInvocation(workItem.invocationId);
    if (!invocation?.templateId || !isGeneratedRouteTemplate(workItem.routeKey, invocation.templateId)) return undefined;
    const loop = this.getLoop(args.loopId);
    if (!loop || loop.schedule.type !== "once" || loop.target.type !== "workflow" || loop.target.workflowId !== args.workflowId) return undefined;
    const input = loop.target.input ?? {};
    if (input.workflowWorkItemId !== workItem.id || input.workflowInvocationId !== invocation.id) return undefined;
    if (workItem.loopId !== loop.id || workItem.workflowId !== args.workflowId) return undefined;
    const workflow = this.getWorkflow(args.workflowId);
    if (!workflow) return undefined;
    return { workflow, loop, workItem, invocation };
  }

  private maybeArchiveGeneratedRouteWorkflow(args: {
    workflowId: string;
    loopId?: string;
    loopRunId?: string;
    workItemId?: string;
    workflowRunId?: string;
    workflowRunStatus?: WorkflowRunStatus;
    updated: string;
  }): void {
    const context = this.generatedRouteArchiveContext(args);
    if (!context) return;
    const { workflow, loop, workItem, invocation } = context;
    if (!workflow || workflow.status !== "active") return;
    if (
      args.loopRunId
      && (args.workflowRunStatus === "failed" || args.workflowRunStatus === "timed_out")
    ) {
      const loopRun = this.getRun(args.loopRunId);
      if (
        loopRun?.status === "running"
        && workItem.status === "admitted"
        && workItem.workflowRunId === args.workflowRunId
      ) return;
      if (loopRun && loopRun.attempt < loop.maxAttempts) return;
    }
    let workflowRunId = args.workflowRunId;
    if (!workflowRunId) {
      if (!args.loopRunId || workItem.workflowRunId) return;
      const loopRun = this.getRun(args.loopRunId);
      if (!loopRun || loopRun.status === "running") return;
      workflowRunId = `preflight-archive:${loopRun.id}`;
      const definitionHash = workflowDefinitionHash(workflow);
      const syntheticError = "workflow preflight failed before workflow execution; synthetic archival event owner";
      this.db
        .query(
          `INSERT OR IGNORE INTO workflow_runs (id, workflow_id, workflow_name, loop_id, loop_run_id, invocation_id,
            work_item_id, scheduled_for, idempotency_key, workflow_definition_hash, manifest_path, status, started_at,
            finished_at, duration_ms, error, created_at, updated_at)
           VALUES ($id, $workflowId, $workflowName, $loopId, $loopRunId, $invocationId, $workItemId, $scheduledFor,
            NULL, $workflowDefinitionHash, NULL, 'failed', NULL, $finished, NULL, $error, $created, $updated)`,
        )
        .run({
          $id: workflowRunId,
          $workflowId: workflow.id,
          $workflowName: workflow.name,
          $loopId: loop.id,
          $loopRunId: loopRun.id,
          $invocationId: invocation.id,
          $workItemId: workItem.id,
          $scheduledFor: loopRun.scheduledFor,
          $workflowDefinitionHash: definitionHash,
          $finished: args.updated,
          $error: syntheticError,
          $created: args.updated,
          $updated: args.updated,
        });
      const archivalOwner = this.db
        .query<WorkflowRunRow, [string]>("SELECT * FROM workflow_runs WHERE id = ?")
        .get(workflowRunId);
      if (
        !archivalOwner
        || archivalOwner.workflow_id !== workflow.id
        || archivalOwner.workflow_name !== workflow.name
        || archivalOwner.loop_id !== loop.id
        || archivalOwner.loop_run_id !== loopRun.id
        || archivalOwner.invocation_id !== invocation.id
        || archivalOwner.work_item_id !== workItem.id
        || archivalOwner.scheduled_for !== loopRun.scheduledFor
        || archivalOwner.idempotency_key !== null
        || archivalOwner.workflow_definition_hash !== definitionHash
        || archivalOwner.manifest_path !== null
        || archivalOwner.status !== "failed"
        || archivalOwner.started_at !== null
        || archivalOwner.finished_at !== args.updated
        || archivalOwner.duration_ms !== null
        || archivalOwner.error !== syntheticError
        || archivalOwner.created_at !== args.updated
        || archivalOwner.updated_at !== args.updated
      ) return;
      this.db
        .query("UPDATE workflow_work_items SET workflow_run_id=?, updated_at=? WHERE id=? AND workflow_run_id IS NULL")
        .run(workflowRunId, args.updated, workItem.id);
    }
    const nonTerminal = this.db
      .query<{ count: number }, [string]>(
        `SELECT COUNT(*) AS count FROM workflow_runs
         WHERE workflow_id = ? AND status NOT IN ('succeeded', 'failed', 'timed_out', 'cancelled')`,
      )
      .get(args.workflowId)?.count ?? 0;
    if (nonTerminal > 0) return;
    const res = this.db
      .query("UPDATE workflow_specs SET status='archived', updated_at=? WHERE id=? AND status='active'")
      .run(args.updated, args.workflowId);
    if (res.changes === 1) {
      this.appendWorkflowEvent(workflowRunId, "workflow_archived", undefined, {
        workflowId: args.workflowId,
        loopId: loop.id,
        workItemId: workItem.id,
        routeKey: workItem.routeKey,
        reason: "terminal generated one-shot route workflow",
      });
    }
  }

  private maybeArchiveTerminalGeneratedRouteWorkflow(workflowRunId: string, updated: string): void {
    const run = this.getWorkflowRun(workflowRunId);
    if (!run) return;
    this.maybeArchiveGeneratedRouteWorkflow({
      workflowId: run.workflowId,
      loopId: run.loopId,
      loopRunId: run.loopRunId,
      workItemId: run.workItemId,
      workflowRunId,
      workflowRunStatus: run.status,
      updated,
    });
  }

  private taskLifecycleTodosPointerContext(workflowRunId: string): {
    todosProjectPath?: string;
    taskId: string;
    invocationId: string;
    workflowRunId: string;
    manifestPath: string;
  } | undefined {
    const run = this.getWorkflowRun(workflowRunId);
    if (!run || run.status !== "succeeded" || !run.invocationId || !run.workItemId || !run.manifestPath) return undefined;
    const workItem = this.getWorkflowWorkItem(run.workItemId);
    if (!workItem || workItem.routeKey !== "todos-task") return undefined;
    const invocation = this.getWorkflowInvocation(run.invocationId);
    if (!invocation || invocation.templateId !== TASK_LIFECYCLE_TEMPLATE_ID) return undefined;
    const todosProjectPath = invocation.scope?.todosProjectPath;
    const taskId = invocation.subjectRef.id ?? workItem.subjectRef;
    if (!taskId) return undefined;
    return {
      todosProjectPath,
      taskId,
      invocationId: invocation.id,
      workflowRunId: run.id,
      manifestPath: run.manifestPath,
    };
  }

  private syncSuccessfulTaskLifecycleTodosPointers(workflowRunId: string): void {
    const context = this.taskLifecycleTodosPointerContext(workflowRunId);
    if (!context) return;
    const result = runLocalCommand("todos", todosCliArgs(context.todosProjectPath, [
      "task",
      "workflow-pointers",
      context.taskId,
      "--clear",
      "--invocation",
      context.invocationId,
      "--run",
      context.workflowRunId,
      "--manifest",
      context.manifestPath,
      "--state",
      "succeeded",
      "--actor",
      "openloops:task-lifecycle",
    ]));
    this.appendWorkflowEvent(workflowRunId, result.ok ? "todos_workflow_pointers_synced" : "todos_workflow_pointers_sync_failed", undefined, {
      todosProjectPath: context.todosProjectPath,
      taskId: context.taskId,
      invocationId: context.invocationId,
      workflowRunId: context.workflowRunId,
      manifestPath: context.manifestPath,
      mutation: todosMutationSummary(result),
    });
  }

  createWorkflowInvocation(input: CreateWorkflowInvocationInput): WorkflowInvocation {
    const now = nowIso();
    const sourceDedupeKey = input.sourceRef.dedupeKey ?? undefined;
    if (sourceDedupeKey) {
      const existing = this.db
        .query<WorkflowInvocationRow, [string, string]>(
          "SELECT * FROM workflow_invocations WHERE source_kind = ? AND source_dedupe_key = ? LIMIT 1",
        )
        .get(input.sourceRef.kind, sourceDedupeKey);
      if (existing) return rowToWorkflowInvocation(existing);
    }
    const id = input.id ?? genId();
    this.db
      .query(
        `INSERT INTO workflow_invocations (id, workflow_id, template_id, source_kind, source_id, source_dedupe_key,
          source_json, subject_kind, subject_id, subject_path, subject_url, subject_json, intent, scope_json,
          output_policy_json, created_at, updated_at)
         VALUES ($id, $workflowId, $templateId, $sourceKind, $sourceId, $sourceDedupeKey, $sourceJson,
          $subjectKind, $subjectId, $subjectPath, $subjectUrl, $subjectJson, $intent, $scopeJson,
          $outputPolicyJson, $created, $updated)`,
      )
      .run({
        $id: id,
        $workflowId: input.workflowId ?? null,
        $templateId: input.templateId ?? null,
        $sourceKind: input.sourceRef.kind,
        $sourceId: input.sourceRef.id ?? null,
        $sourceDedupeKey: sourceDedupeKey ?? null,
        $sourceJson: JSON.stringify(input.sourceRef),
        $subjectKind: input.subjectRef.kind,
        $subjectId: input.subjectRef.id ?? null,
        $subjectPath: input.subjectRef.path ?? null,
        $subjectUrl: input.subjectRef.url ?? null,
        $subjectJson: JSON.stringify(input.subjectRef),
        $intent: input.intent,
        $scopeJson: input.scope ? JSON.stringify(input.scope) : null,
        $outputPolicyJson: input.outputPolicy ? JSON.stringify(input.outputPolicy) : null,
        $created: now,
        $updated: now,
      });
    const row = this.db.query<WorkflowInvocationRow, [string]>("SELECT * FROM workflow_invocations WHERE id = ?").get(id);
    if (!row) throw new Error(`workflow invocation not found after create: ${id}`);
    return rowToWorkflowInvocation(row);
  }

  refreshWorkflowInvocationForWorkItem(workItemId: string, input: CreateWorkflowInvocationInput): WorkflowInvocation {
    const sourceDedupeKey = input.sourceRef.dedupeKey ?? undefined;
    if (!sourceDedupeKey) throw new Error("cannot refresh workflow invocation without sourceRef.dedupeKey");
    const now = nowIso();
    const claimableStatuses: WorkflowWorkItemStatus[] = ["queued", "deferred"];
    const statusBindings = Object.fromEntries(claimableStatuses.map((status, index) => [`$status${index}`, status]));
    const placeholders = claimableStatuses.map((_, index) => `$status${index}`).join(",");
    const result = this.db
      .query(
        `UPDATE workflow_invocations
         SET workflow_id=COALESCE($workflowId, workflow_id),
          template_id=COALESCE($templateId, template_id),
          source_id=COALESCE($sourceId, source_id),
          source_json=$sourceJson,
          subject_kind=$subjectKind,
          subject_id=COALESCE($subjectId, subject_id),
          subject_path=COALESCE($subjectPath, subject_path),
          subject_url=COALESCE($subjectUrl, subject_url),
          subject_json=$subjectJson,
          intent=$intent,
          scope_json=COALESCE($scopeJson, scope_json),
          output_policy_json=COALESCE($outputPolicyJson, output_policy_json),
          updated_at=$updated
         WHERE source_kind=$sourceKind
          AND source_dedupe_key=$sourceDedupeKey
          AND EXISTS (
            SELECT 1
            FROM workflow_work_items
            WHERE id=$workItemId
              AND invocation_id=workflow_invocations.id
              AND status IN (${placeholders})
          )`,
      )
      .run({
        $workItemId: workItemId,
        $sourceKind: input.sourceRef.kind,
        $sourceDedupeKey: sourceDedupeKey,
        $workflowId: input.workflowId ?? null,
        $templateId: input.templateId ?? null,
        $sourceId: input.sourceRef.id ?? null,
        $sourceJson: JSON.stringify(input.sourceRef),
        $subjectKind: input.subjectRef.kind,
        $subjectId: input.subjectRef.id ?? null,
        $subjectPath: input.subjectRef.path ?? null,
        $subjectUrl: input.subjectRef.url ?? null,
        $subjectJson: JSON.stringify(input.subjectRef),
        $intent: input.intent,
        $scopeJson: input.scope ? JSON.stringify(input.scope) : null,
        $outputPolicyJson: input.outputPolicy ? JSON.stringify(input.outputPolicy) : null,
        $updated: now,
        ...statusBindings,
      });
    if (result.changes !== 1) throw new Error(`workflow work item is not refreshable: ${workItemId}`);
    const updated = this.db
      .query<WorkflowInvocationRow, [string]>(
        `SELECT workflow_invocations.*
         FROM workflow_invocations
         JOIN workflow_work_items ON workflow_work_items.invocation_id = workflow_invocations.id
         WHERE workflow_work_items.id = ?`,
      )
      .get(workItemId);
    if (!updated) throw new Error(`workflow invocation not found after refresh for work item: ${workItemId}`);
    return rowToWorkflowInvocation(updated);
  }

  getWorkflowInvocation(id: string): WorkflowInvocation | undefined {
    const row = this.db.query<WorkflowInvocationRow, [string]>("SELECT * FROM workflow_invocations WHERE id = ?").get(id);
    return row ? rowToWorkflowInvocation(row) : undefined;
  }

  listWorkflowInvocations(opts: { limit?: number } = {}): WorkflowInvocation[] {
    const rows = this.db
      .query<WorkflowInvocationRow, [number]>("SELECT * FROM workflow_invocations ORDER BY created_at DESC LIMIT ?")
      .all(opts.limit ?? 100);
    return rows.map(rowToWorkflowInvocation);
  }

  upsertWorkflowWorkItem(input: UpsertWorkflowWorkItemInput): WorkflowWorkItem {
    const now = nowIso();
    const id = input.id ?? genId();
    const status = input.status ?? "queued";
    this.db
      .query(
        `INSERT INTO workflow_work_items (id, route_key, idempotency_key, invocation_id, source_type, source_ref,
          subject_ref, project_key, project_group, machine_id, route_scope, priority, status, attempts, next_attempt_at, lease_expires_at,
          workflow_id, loop_id, workflow_run_id, last_reason, created_at, updated_at)
         VALUES ($id, $routeKey, $idempotencyKey, $invocationId, $sourceType, $sourceRef, $subjectRef,
          $projectKey, $projectGroup, $machineId, $routeScope, $priority, $status, 0, $nextAttemptAt, NULL, NULL, NULL, NULL,
          $lastReason, $created, $updated)
         ON CONFLICT(route_key, idempotency_key) DO UPDATE SET
          invocation_id=excluded.invocation_id,
          source_type=excluded.source_type,
          source_ref=excluded.source_ref,
          subject_ref=excluded.subject_ref,
          project_key=excluded.project_key,
          project_group=excluded.project_group,
          machine_id=CASE
            WHEN workflow_work_items.status IN ('succeeded', 'admitted', 'running', 'failed', 'dead_letter', 'cancelled') THEN workflow_work_items.machine_id
            ELSE excluded.machine_id
          END,
          route_scope=excluded.route_scope,
          priority=excluded.priority,
          status=CASE
            WHEN workflow_work_items.status IN ('succeeded', 'admitted', 'running', 'failed', 'dead_letter', 'cancelled')
              THEN workflow_work_items.status
            ELSE excluded.status
          END,
          workflow_id=CASE
            WHEN workflow_work_items.status IN ('succeeded', 'admitted', 'running', 'failed', 'dead_letter', 'cancelled') THEN workflow_work_items.workflow_id
            ELSE NULL
          END,
          loop_id=CASE
            WHEN workflow_work_items.status IN ('succeeded', 'admitted', 'running', 'failed', 'dead_letter', 'cancelled') THEN workflow_work_items.loop_id
            ELSE NULL
          END,
          workflow_run_id=CASE
            WHEN workflow_work_items.status IN ('succeeded', 'admitted', 'running', 'failed', 'dead_letter', 'cancelled') THEN workflow_work_items.workflow_run_id
            ELSE NULL
          END,
          lease_expires_at=CASE
            WHEN workflow_work_items.status IN ('succeeded', 'admitted', 'running', 'failed', 'dead_letter', 'cancelled') THEN workflow_work_items.lease_expires_at
            ELSE NULL
          END,
          next_attempt_at=excluded.next_attempt_at,
          last_reason=CASE
            WHEN workflow_work_items.attempts > 0
              AND workflow_work_items.status IN ('queued', 'deferred')
              AND workflow_work_items.last_reason IS NOT NULL
              AND excluded.last_reason IS NOT NULL
              THEN workflow_work_items.last_reason || '; ' || excluded.last_reason
            ELSE COALESCE(excluded.last_reason, workflow_work_items.last_reason)
          END,
          updated_at=excluded.updated_at`,
      )
      .run({
        $id: id,
        $routeKey: input.routeKey,
        $idempotencyKey: input.idempotencyKey,
        $invocationId: input.invocationId,
        $sourceType: input.sourceType,
        $sourceRef: input.sourceRef,
        $subjectRef: input.subjectRef,
        $projectKey: input.projectKey ?? null,
        $projectGroup: input.projectGroup ?? null,
        $machineId: input.machineId ?? null,
        $routeScope: input.routeScope ?? null,
        $priority: input.priority ?? 0,
        $status: status,
        $nextAttemptAt: input.nextAttemptAt ?? null,
        $lastReason: input.lastReason ?? null,
        $created: now,
        $updated: now,
      });
    const row = this.db
      .query<WorkflowWorkItemRow, [string, string]>(
        "SELECT * FROM workflow_work_items WHERE route_key = ? AND idempotency_key = ? LIMIT 1",
      )
      .get(input.routeKey, input.idempotencyKey);
    if (!row) throw new Error(`workflow work item not found after upsert: ${input.routeKey}/${input.idempotencyKey}`);
    return rowToWorkflowWorkItem(row);
  }

  getWorkflowWorkItem(id: string): WorkflowWorkItem | undefined {
    const row = this.db.query<WorkflowWorkItemRow, [string]>("SELECT * FROM workflow_work_items WHERE id = ?").get(id);
    return row ? rowToWorkflowWorkItem(row) : undefined;
  }

  findWorkflowWorkItem(routeKey: string, idempotencyKey: string): WorkflowWorkItem | undefined {
    const row = this.db
      .query<WorkflowWorkItemRow, [string, string]>(
        "SELECT * FROM workflow_work_items WHERE route_key = ? AND idempotency_key = ? LIMIT 1",
      )
      .get(routeKey, idempotencyKey);
    return row ? rowToWorkflowWorkItem(row) : undefined;
  }

  listWorkflowWorkItems(opts: { status?: WorkflowWorkItemStatus; routeKey?: string; limit?: number } = {}): WorkflowWorkItem[] {
    const limit = opts.limit ?? 100;
    let rows: WorkflowWorkItemRow[];
    if (opts.status && opts.routeKey) {
      rows = this.db
        .query<WorkflowWorkItemRow, [string, string, number]>(
          "SELECT * FROM workflow_work_items WHERE route_key = ? AND status = ? ORDER BY priority DESC, created_at ASC LIMIT ?",
        )
        .all(opts.routeKey, opts.status, limit);
    } else if (opts.status) {
      rows = this.db
        .query<WorkflowWorkItemRow, [string, number]>(
          "SELECT * FROM workflow_work_items WHERE status = ? ORDER BY priority DESC, created_at ASC LIMIT ?",
        )
        .all(opts.status, limit);
    } else if (opts.routeKey) {
      rows = this.db
        .query<WorkflowWorkItemRow, [string, number]>(
          "SELECT * FROM workflow_work_items WHERE route_key = ? ORDER BY created_at DESC LIMIT ?",
        )
        .all(opts.routeKey, limit);
    } else {
      rows = this.db.query<WorkflowWorkItemRow, [number]>("SELECT * FROM workflow_work_items ORDER BY created_at DESC LIMIT ?").all(limit);
    }
    return rows.map(rowToWorkflowWorkItem);
  }

  countActiveWorkflowWorkItems(args: { projectKey?: string; projectGroup?: string; routeScope?: string } = {}): {
    global: number;
    project: number;
    projectGroup?: number;
  } {
    const active = ["admitted", "running"];
    const placeholders = active.map(() => "?").join(",");
    // `global` is the ceiling that `--max-active` compares against. When a
    // route scope is supplied (the loop/drain identity that set the limit) the
    // count is filtered to that route so each router's `--max-active` is its
    // OWN ceiling rather than a store-wide one shared by every router. Without
    // a scope it stays store-wide for back-compat. `project`/`projectGroup`
    // counts are deliberately unscoped — they are cross-route anti-hog caps.
    const routeScope = args.routeScope?.trim() || undefined;
    const global = routeScope
      ? this.db
          .query<{ count: number }, string[]>(
            `SELECT COUNT(*) AS count FROM workflow_work_items WHERE status IN (${placeholders}) AND route_scope = ?`,
          )
          .get(...active, routeScope)?.count ?? 0
      : this.db
          .query<{ count: number }, string[]>(`SELECT COUNT(*) AS count FROM workflow_work_items WHERE status IN (${placeholders})`)
          .get(...active)?.count ?? 0;
    const project = args.projectKey
      ? this.db
          .query<{ count: number }, string[]>(
            `SELECT COUNT(*) AS count FROM workflow_work_items WHERE status IN (${placeholders}) AND project_key = ?`,
          )
          .get(...active, args.projectKey)?.count ?? 0
      : 0;
    const projectGroup = args.projectGroup
      ? this.db
          .query<{ count: number }, string[]>(
            `SELECT COUNT(*) AS count FROM workflow_work_items WHERE status IN (${placeholders}) AND project_group = ?`,
          )
          .get(...active, args.projectGroup)?.count ?? 0
      : undefined;
    return { global, project, ...(projectGroup !== undefined ? { projectGroup } : {}) };
  }

  /**
   * Number of currently-running workflow steps per resolved auth profile
   * (account_profile). Drives least-loaded pool selection and the
   * `--max-per-profile` guard so concurrency spreads across subscription
   * accounts instead of stacking on one (the provider-side 429 wall). Only
   * `running` steps are counted: within a workflow steps run sequentially, so a
   * profile's running count is the number of concurrent workflows executing a
   * step on that account right now — exactly the concurrency to bound.
   */
  countRunningWorkflowStepsByAuthProfile(): Record<string, number> {
    const rows = this.db
      .query<{ account_profile: string | null; count: number }, []>(
        "SELECT account_profile, COUNT(*) AS count FROM workflow_step_runs WHERE status = 'running' AND account_profile IS NOT NULL GROUP BY account_profile",
      )
      .all();
    const counts: Record<string, number> = {};
    for (const row of rows) {
      if (row.account_profile) counts[row.account_profile] = row.count;
    }
    return counts;
  }

  /**
   * Requeue a terminal admission work item for the next task/event delivery.
   * By default `attempts` is preserved (used by the bounded stale-terminal
   * re-admission on the route path, which must keep counting toward the cap).
   * Pass `resetAttempts: true` for the operator unwedge (`loops routes requeue`)
   * so a manual requeue is DURABLE rather than one-shot: without the reset a
   * capped item that finishes terminal once more re-caps instantly.
   */
  requeueWorkflowWorkItem(id: string, patch: { reason?: string; resetAttempts?: boolean } = {}): WorkflowWorkItem {
    const current = this.getWorkflowWorkItem(id);
    if (!current) throw new Error(`workflow work item not found: ${id}`);
    const requeueableStatuses: WorkflowWorkItemStatus[] = ["succeeded", "failed", "dead_letter", "cancelled"];
    if (!requeueableStatuses.includes(current.status)) {
      throw new Error(`workflow work item is not requeueable: ${id} status=${current.status}`);
    }
    const now = nowIso();
    const reason = patch.reason?.trim() || `requeued from ${current.status}`;
    const placeholders = requeueableStatuses.map(() => "?").join(",");
    const res = this.db
      .query(
        `UPDATE workflow_work_items
         SET status='queued', workflow_id=NULL, loop_id=NULL, workflow_run_id=NULL,
          ${patch.resetAttempts ? "attempts=0, gate_deaths=0," : ""}
          next_attempt_at=NULL, lease_expires_at=NULL, last_reason=?, updated_at=?
         WHERE id=? AND status IN (${placeholders})`,
      )
      .run(reason, now, id, ...requeueableStatuses);
    const item = this.getWorkflowWorkItem(id);
    if (!item) throw new Error(`workflow work item not found after requeue: ${id}`);
    if (res.changes !== 1) throw new Error(`workflow work item was not requeued: ${id} status=${item.status}`);
    return item;
  }

  /**
   * Transition a terminal admission work item to `dead_letter`. Used by the
   * route path when a still-actionable todos task has exhausted the redispatch
   * cap: instead of silently deduping the same terminal row forever (the "black
   * hole" — `considered=N created=0` with no signal), the item is moved to a
   * visible `dead_letter` state so drain reports can surface + count it and an
   * operator can `loops routes requeue` it. Idempotent: a no-op on an item that
   * is already dead-lettered.
   */
  deadLetterWorkflowWorkItem(id: string, patch: { reason?: string } = {}): WorkflowWorkItem {
    const now = nowIso();
    const reason = patch.reason?.trim() || "redispatch cap reached; dead-lettered";
    this.db
      .query(
        `UPDATE workflow_work_items
         SET status='dead_letter', next_attempt_at=NULL, lease_expires_at=NULL, last_reason=?, updated_at=?
         WHERE id=? AND status IN ('succeeded','failed','cancelled')`,
      )
      .run(reason, now, id);
    const item = this.getWorkflowWorkItem(id);
    if (!item) throw new Error(`workflow work item not found after dead-letter: ${id}`);
    return item;
  }

  /**
   * Refund a redispatch attempt for a *failed* run that never did real work.
   * Called from {@link finalizeWorkflowRun} the moment a work item is set
   * `failed`, so the todos-task redispatch cap only ever counts real worker
   * attempts. A tempfail (`exit 75`) is additionally made requeueable (dropped
   * back to `queued`, bindings cleared) so its "retry later" contract fires on
   * the next drain instead of persisting as a terminal, dedupe-forever row. A
   * gate death stays `failed` (the bounded re-admission picks it up after
   * backoff once the underlying infra fault clears). Both floor attempts at 0.
   */
  private demoteNonProductiveWorkItems(workflowRunId: string, finishedAt: string): void {
    const kind = classifyNonProductiveStepFailure(this.listWorkflowStepRuns(workflowRunId));
    if (!kind) {
      // Productive failure: the worker ran and did real work, so any
      // consecutive-gate-death streak is broken.
      this.db
        .query("UPDATE workflow_work_items SET gate_deaths=0, updated_at=? WHERE workflow_run_id=? AND status='failed' AND gate_deaths > 0")
        .run(finishedAt, workflowRunId);
      return;
    }
    if (kind === "tempfail") {
      // A tempfail also reached the worker (it executed and said "retry
      // later"), so it breaks the gate-death streak too.
      this.db
        .query(
          `UPDATE workflow_work_items
           SET status='queued', attempts=CASE WHEN attempts > 0 THEN attempts - 1 ELSE 0 END,
            gate_deaths=0,
            workflow_id=NULL, loop_id=NULL, workflow_run_id=NULL,
            next_attempt_at=NULL, lease_expires_at=NULL,
            last_reason='worker exited 75 (tempfail): requeued for retry; attempt refunded (does not count toward redispatch cap)',
            updated_at=?
           WHERE workflow_run_id=? AND status='failed'`,
        )
        .run(finishedAt, workflowRunId);
      return;
    }
    // Gate death: refund the attempt (the worker never ran) but count the
    // consecutive streak. A deterministic infrastructure fault would otherwise
    // retry forever at the backoff floor; at the ceiling the item is
    // dead-lettered — visible in drain reports via the deadLettered surfacing —
    // instead of spinning. An operator `routes requeue` (attempts reset) clears
    // the streak and re-arms the full ceiling.
    this.db
      .query(
        `UPDATE workflow_work_items
         SET attempts=CASE WHEN attempts > 0 THEN attempts - 1 ELSE 0 END,
          gate_deaths=gate_deaths + 1,
          status=CASE WHEN gate_deaths + 1 >= ${GATE_DEATH_CEILING} THEN 'dead_letter' ELSE status END,
          last_reason=CASE
            WHEN gate_deaths + 1 >= ${GATE_DEATH_CEILING}
              THEN 'gate-death ceiling reached (' || (gate_deaths + 1) || '/${GATE_DEATH_CEILING} consecutive runs died at worktree prep / triage / planner without reaching the worker): dead-lettered — the infrastructure fault needs an operator; ''loops routes requeue'' resets and retries'
            ELSE 'gate death before real work (worktree prep / triage / planner): attempt refunded (does not count toward redispatch cap); consecutive gate deaths: ' || (gate_deaths + 1) || '/${GATE_DEATH_CEILING}'
          END,
          updated_at=?
         WHERE workflow_run_id=? AND status='failed'`,
      )
      .run(finishedAt, workflowRunId);
  }

  admitWorkflowWorkItem(id: string, patch: { workflowId: string; loopId: string; reason?: string }): WorkflowWorkItem {
    const now = nowIso();
    const res = this.db
      .query(
        `UPDATE workflow_work_items
         SET status='admitted', attempts=attempts + 1, workflow_id=$workflowId, loop_id=$loopId,
          next_attempt_at=NULL,
          lease_expires_at=NULL,
          last_reason=CASE
            WHEN last_reason IS NOT NULL AND $reason IS NOT NULL THEN last_reason || '; ' || $reason
            ELSE COALESCE($reason, last_reason)
          END,
          updated_at=$updated
         WHERE id=$id AND status IN ('queued', 'deferred')`,
      )
      .run({
        $id: id,
        $workflowId: patch.workflowId,
        $loopId: patch.loopId,
        $reason: patch.reason ?? null,
        $updated: now,
      });
    const item = this.getWorkflowWorkItem(id);
    if (!item) throw new Error(`workflow work item not found after admit: ${id}`);
    if (res.changes !== 1) throw new Error(`workflow work item is not claimable: ${id} status=${item.status}`);
    return item;
  }

  private setWorkflowWorkItemsForLoop(
    loopId: string,
    status: WorkflowWorkItemStatus,
    reason: string | undefined,
    updated: string,
    statuses: WorkflowWorkItemStatus[] = ["admitted", "running"],
  ): void {
    const placeholders = statuses.map(() => "?").join(",");
    this.db
      .query(
        `UPDATE workflow_work_items
         SET status=?, lease_expires_at=NULL, last_reason=COALESCE(?, last_reason), updated_at=?
         WHERE loop_id = ? AND status IN (${placeholders})`,
      )
      .run(status, reason ?? null, updated, loopId, ...statuses);
  }

  private setWorkflowWorkItemsForWorkflowRun(
    workflowRunId: string,
    status: WorkflowWorkItemStatus,
    reason: string | undefined,
    updated: string,
    statuses: WorkflowWorkItemStatus[] = ["admitted", "running"],
  ): void {
    const placeholders = statuses.map(() => "?").join(",");
    this.db
      .query(
        `UPDATE workflow_work_items
         SET status=?, lease_expires_at=NULL, last_reason=COALESCE(?, last_reason), updated_at=?
         WHERE workflow_run_id = ? AND status IN (${placeholders})`,
      )
      .run(status, reason ?? null, updated, workflowRunId, ...statuses);
  }

  private setWorkflowWorkItemsForLoopRun(run: LoopRun, reason: string | undefined, updated: string): void {
    const loop = this.getLoop(run.loopId);
    const status = workItemStatusForLoopRun(run.status, run.attempt, loop?.maxAttempts);
    if (!status) return;
    const statuses: WorkflowWorkItemStatus[] = status === "admitted"
      ? ["admitted", "running", "failed"]
      : ["admitted", "running"];
    const nextReason = status === "admitted"
      ? reason ? `attempt failed; retry pending: ${reason}` : "attempt failed; retry pending"
      : reason;
    this.setWorkflowWorkItemsForLoop(run.loopId, status, nextReason, updated, statuses);
  }

  createGoal(input: CreateGoalInput, opts: DaemonLeaseFence = {}): Goal {
    const now = nowIso();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.assertDaemonLeaseFence(opts, now);
      const id = genId();
      this.db
        .query(
          `INSERT INTO goals (id, plan_id, objective, status, token_budget, tokens_used, time_used_seconds, auto_execute,
            max_tokens, source_type, source_id, loop_id, loop_run_id, workflow_id, workflow_run_id, workflow_step_id,
            created_at, updated_at)
           VALUES ($id, $planId, $objective, 'active', $tokenBudget, 0, 0, $autoExecute, $maxTokens, $sourceType,
            $sourceId, $loopId, $loopRunId, $workflowId, $workflowRunId, $workflowStepId, $created, $updated)`,
        )
        .run({
          $id: id,
          $planId: id,
          $objective: input.objective,
          $tokenBudget: input.tokenBudget ?? null,
          $autoExecute: input.autoExecute ?? "readyOnly",
          $maxTokens: input.maxTokens ?? input.tokenBudget ?? null,
          $sourceType: input.sourceType ?? null,
          $sourceId: input.sourceId ?? null,
          $loopId: input.loopId ?? null,
          $loopRunId: input.loopRunId ?? null,
          $workflowId: input.workflowId ?? null,
          $workflowRunId: input.workflowRunId ?? null,
          $workflowStepId: input.workflowStepId ?? null,
          $created: now,
          $updated: now,
        });
      this.db.exec("COMMIT");
      return this.requireGoal(id);
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      throw error;
    }
  }

  getGoal(id: string): Goal | undefined {
    const row = this.db.query<GoalRow, [string]>("SELECT * FROM goals WHERE id = ?").get(id);
    return row ? rowToGoal(row) : undefined;
  }

  requireGoal(id: string): Goal {
    const goal = this.getGoal(id);
    if (!goal) throw new Error(`goal not found: ${id}`);
    return goal;
  }

  findGoalByLoop(idOrName: string): Goal | undefined {
    const loop = this.getLoop(idOrName) ?? this.findLoopByName(idOrName);
    if (!loop) return undefined;
    const row = this.db
      .query<GoalRow, [string]>("SELECT * FROM goals WHERE loop_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(loop.id);
    return row ? rowToGoal(row) : undefined;
  }

  findGoalByRunId(id: string): Goal | undefined {
    const direct = this.getGoal(id);
    if (direct) return direct;
    const event = this.db.query<GoalRunRow, [string]>("SELECT * FROM goal_runs WHERE id = ?").get(id);
    if (event) return this.getGoal(event.goal_id);
    const row = this.db
      .query<GoalRow, [string, string, string]>(
        `SELECT * FROM goals
         WHERE loop_run_id = ? OR workflow_run_id = ? OR workflow_step_id = ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(id, id, id);
    return row ? rowToGoal(row) : undefined;
  }

  findGoalByContext(context: {
    loopRunId?: string;
    workflowRunId?: string;
    workflowStepId?: string;
    sourceType?: string;
    sourceId?: string;
  }): Goal | undefined {
    if (context.loopRunId) {
      const row = this.db
        .query<GoalRow, [string, string | null, string | null]>(
          `SELECT * FROM goals
           WHERE loop_run_id = ? AND (? IS NULL OR workflow_step_id = ?)
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(context.loopRunId, context.workflowStepId ?? null, context.workflowStepId ?? null);
      if (row) return rowToGoal(row);
    }
    if (context.workflowRunId) {
      const row = this.db
        .query<GoalRow, [string, string | null, string | null]>(
          `SELECT * FROM goals
           WHERE workflow_run_id = ? AND (? IS NULL OR workflow_step_id = ?)
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(context.workflowRunId, context.workflowStepId ?? null, context.workflowStepId ?? null);
      if (row) return rowToGoal(row);
    }
    if (context.sourceType && context.sourceId) {
      // Skip terminal goals: a manual re-run after cancelled/budgetLimited/complete
      // must start a fresh goal, not reuse the terminal one (reuse hits
      // assertGoalTransition and throws "cannot transition terminal goal status").
      // Only non-terminal manual goals are resumable in place.
      const terminalPlaceholders = GOAL_TERMINAL.map(() => "?").join(", ");
      const row = this.db
        .query<GoalRow, [string, string, ...string[]]>(
          `SELECT * FROM goals
           WHERE source_type = ? AND source_id = ? AND status NOT IN (${terminalPlaceholders})
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(context.sourceType, context.sourceId, ...GOAL_TERMINAL);
      if (row) return rowToGoal(row);
    }
    return undefined;
  }

  listGoals(opts: { status?: GoalStatus; limit?: number } = {}): Goal[] {
    const limit = opts.limit ?? 100;
    const rows = opts.status
      ? this.db
          .query<GoalRow, [string, number]>("SELECT * FROM goals WHERE status = ? ORDER BY created_at DESC LIMIT ?")
          .all(opts.status, limit)
      : this.db.query<GoalRow, [number]>("SELECT * FROM goals ORDER BY created_at DESC LIMIT ?").all(limit);
    return rows.map(rowToGoal);
  }

  createGoalPlanNodes(goalId: string, nodes: CreateGoalPlanNodeInput[], opts: DaemonLeaseFence = {}): GoalPlanNode[] {
    const goal = this.requireGoal(goalId);
    const now = nowIso();
    const materialized: GoalPlanNode[] = nodes.map((node, sequence) => ({
      nodeId: genId(),
      planId: goal.planId,
      key: node.key,
      sequence,
      priority: node.priority ?? 0,
      objective: node.objective,
      status: "pending",
      ready: false,
      tokenBudget: node.tokenBudget,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      dependsOn: node.dependsOn ?? [],
      createdAt: now,
      updatedAt: now,
    }));
    const withReady = updateReadyFlags(materialized, "active");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.assertDaemonLeaseFence(opts, now);
      for (const node of withReady) {
        this.insertGoalPlanNode(goal, node);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      throw error;
    }
    return this.listGoalPlanNodes(goalId);
  }

  /**
   * Insert a plan node, detecting (rather than silently ignoring) conflicts:
   * an existing (plan_id, key) row means the node is already planned and is
   * kept; a primary-key collision retries with a fresh id instead of dropping
   * the node on the floor.
   */
  private insertGoalPlanNode(goal: Goal, node: GoalPlanNode): void {
    let id = node.nodeId;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const res = this.db
        .query(
          `INSERT OR IGNORE INTO goal_plan_nodes (id, goal_id, plan_id, key, sequence, priority, objective, status, ready,
            token_budget, tokens_used, time_used_seconds, depends_on_json, created_at, updated_at)
           VALUES ($id, $goalId, $planId, $key, $sequence, $priority, $objective, $status, $ready, $tokenBudget,
            $tokensUsed, $timeUsedSeconds, $dependsOn, $created, $updated)`,
        )
        .run({
          $id: id,
          $goalId: goal.goalId,
          $planId: goal.planId,
          $key: node.key,
          $sequence: node.sequence,
          $priority: node.priority,
          $objective: node.objective,
          $status: node.status,
          $ready: node.ready ? 1 : 0,
          $tokenBudget: node.tokenBudget ?? null,
          $tokensUsed: node.tokensUsed,
          $timeUsedSeconds: node.timeUsedSeconds,
          $dependsOn: JSON.stringify(node.dependsOn),
          $created: node.createdAt,
          $updated: node.updatedAt,
        });
      if (res.changes === 1) return;
      const existingByKey = this.db
        .query<{ id: string }, [string, string]>("SELECT id FROM goal_plan_nodes WHERE plan_id = ? AND key = ? LIMIT 1")
        .get(goal.planId, node.key);
      if (existingByKey) return;
      id = genId();
    }
    throw new Error(`goal plan node was not inserted after id retries: ${goal.planId}/${node.key}`);
  }

  listGoalPlanNodes(goalIdOrPlanId: string): GoalPlanNode[] {
    const rows = this.db
      .query<GoalPlanNodeRow, [string, string]>(
        "SELECT * FROM goal_plan_nodes WHERE goal_id = ? OR plan_id = ? ORDER BY sequence ASC",
      )
      .all(goalIdOrPlanId, goalIdOrPlanId);
    return rows.map(rowToGoalPlanNode);
  }

  updateGoalStatus(goalId: string, status: GoalStatus, opts: DaemonLeaseFence = {}): Goal {
    const current = this.requireGoal(goalId);
    assertGoalTransition(current.status, status);
    const now = (opts.now ?? new Date()).toISOString();
    this.db
      .query(
        `UPDATE goals SET status=$status, updated_at=$updated
         WHERE id=$id
           AND ($daemonLeaseId IS NULL OR EXISTS (
             SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
           ))`,
      )
      .run({
        $id: goalId,
        $status: status,
        $updated: now,
        $daemonLeaseId: opts.daemonLeaseId ?? null,
        $now: now,
      });
    return this.requireGoal(goalId);
  }

  addGoalUsage(goalId: string, tokens: number, timeUsedSeconds = 0, opts: DaemonLeaseFence = {}): Goal {
    const now = (opts.now ?? new Date()).toISOString();
    this.db
      .query(
        `UPDATE goals
         SET tokens_used=tokens_used + $tokens, time_used_seconds=time_used_seconds + $seconds, updated_at=$updated
         WHERE id=$id
           AND ($daemonLeaseId IS NULL OR EXISTS (
             SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
           ))`,
      )
      .run({
        $id: goalId,
        $tokens: tokens,
        $seconds: timeUsedSeconds,
        $updated: now,
        $daemonLeaseId: opts.daemonLeaseId ?? null,
        $now: now,
      });
    return this.requireGoal(goalId);
  }

  updateGoalPlanNode(
    goalId: string,
    key: string,
    patch: Partial<Pick<GoalPlanNode, "status" | "tokensUsed" | "timeUsedSeconds" | "ready">>,
    opts: DaemonLeaseFence = {},
  ): GoalPlanNode {
    const now = (opts.now ?? new Date()).toISOString();
    this.db
      .query(
        `UPDATE goal_plan_nodes
         SET status=COALESCE($status, status),
          tokens_used=COALESCE($tokensUsed, tokens_used),
          time_used_seconds=COALESCE($timeUsedSeconds, time_used_seconds),
          ready=COALESCE($ready, ready),
          updated_at=$updated
         WHERE goal_id=$goalId AND key=$key
           AND ($daemonLeaseId IS NULL OR EXISTS (
             SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
           ))`,
      )
      .run({
        $goalId: goalId,
        $key: key,
        $status: patch.status ?? null,
        $tokensUsed: patch.tokensUsed ?? null,
        $timeUsedSeconds: patch.timeUsedSeconds ?? null,
        $ready: patch.ready === undefined ? null : patch.ready ? 1 : 0,
        $updated: now,
        $daemonLeaseId: opts.daemonLeaseId ?? null,
        $now: now,
      });
    const node = this.listGoalPlanNodes(goalId).find((entry) => entry.key === key);
    if (!node) throw new Error(`goal node not found: ${goalId}/${key}`);
    return node;
  }

  recordGoalEvent(input: RecordGoalEventInput, opts: DaemonLeaseFence = {}): GoalRun {
    const goal = this.requireGoal(input.goalId);
    const now = nowIso();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.assertDaemonLeaseFence(opts, now);
      const previous = this.db
        .query<{ turn: number | null }, [string]>("SELECT MAX(turn) AS turn FROM goal_runs WHERE goal_id = ?")
        .get(goal.goalId);
      const turn = input.turn ?? (previous?.turn ?? 0) + 1;
      const id = genId();
      this.db
        .query(
          `INSERT INTO goal_runs (id, goal_id, plan_id, loop_id, loop_run_id, workflow_id, workflow_run_id, workflow_step_id,
            turn, phase, status, node_key, tokens_used, evidence_json, raw_response_json, created_at, updated_at)
           VALUES ($id, $goalId, $planId, $loopId, $loopRunId, $workflowId, $workflowRunId, $workflowStepId,
            $turn, $phase, $status, $nodeKey, $tokensUsed, $evidence, $rawResponse, $created, $updated)`,
        )
        .run({
          $id: id,
          $goalId: goal.goalId,
          $planId: goal.planId,
          $loopId: goal.loopId ?? null,
          $loopRunId: goal.loopRunId ?? null,
          $workflowId: goal.workflowId ?? null,
          $workflowRunId: goal.workflowRunId ?? null,
          $workflowStepId: goal.workflowStepId ?? null,
          $turn: turn,
          $phase: input.phase,
          $status: input.status,
          $nodeKey: input.nodeKey ?? null,
          $tokensUsed: input.tokensUsed ?? 0,
          // Scrub string leaves BEFORE stringify (which escapes quotes and
          // would hide quoted secrets), then scrub the encoded document too
          // for token shapes that survive escaping. Both passes are idempotent.
          $evidence: input.evidence ? persistedJson(input.evidence) : null,
          $rawResponse: input.rawResponse === undefined ? null : persistedJson(input.rawResponse),
          $created: now,
          $updated: now,
        });
      if (input.tokensUsed && input.tokensUsed > 0) {
        this.db
          .query("UPDATE goals SET tokens_used=tokens_used + ?, updated_at=? WHERE id=?")
          .run(input.tokensUsed, now, goal.goalId);
      }
      this.db.exec("COMMIT");
      const event = this.db.query<GoalRunRow, [string]>("SELECT * FROM goal_runs WHERE id = ?").get(id);
      if (!event) throw new Error(`goal run not found after record: ${id}`);
      return rowToGoalRun(event);
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      throw error;
    }
  }

  listGoalRuns(opts: { goalId?: string; runId?: string; limit?: number } = {}): GoalRun[] {
    const limit = opts.limit ?? 200;
    let rows: GoalRunRow[];
    if (opts.goalId) {
      rows = this.db
        .query<GoalRunRow, [string, number]>("SELECT * FROM goal_runs WHERE goal_id = ? ORDER BY created_at ASC LIMIT ?")
        .all(opts.goalId, limit);
    } else if (opts.runId) {
      rows = this.db
        .query<GoalRunRow, [string, string, string, number]>(
          `SELECT * FROM goal_runs
           WHERE id = ? OR loop_run_id = ? OR workflow_run_id = ?
           ORDER BY created_at ASC LIMIT ?`,
        )
        .all(opts.runId, opts.runId, opts.runId, limit);
    } else {
      rows = this.db.query<GoalRunRow, [number]>("SELECT * FROM goal_runs ORDER BY created_at DESC LIMIT ?").all(limit);
    }
    return rows.map(rowToGoalRun);
  }

  createWorkflowRun(input: CreateWorkflowRunInput): WorkflowRun {
    const now = nowIso();
    const definitionHash = workflowDefinitionHash(input.workflow);
    const initialContractEvents = initialAgentSessionContractEvents(input.workflow);
    const targetInput = input.loop?.target.type === "workflow" ? input.loop.target.input : undefined;
    const invocationId = input.invocationId ?? targetInput?.workflowInvocationId ?? targetInput?.invocationId;
    const workItemId = input.workItemId ?? targetInput?.workflowWorkItemId ?? targetInput?.workItemId;
    if (input.idempotencyKey) {
      const existing = this.db
        .query<WorkflowRunRow, [string, string]>(
          "SELECT * FROM workflow_runs WHERE workflow_id = ? AND idempotency_key = ? LIMIT 1",
        )
        .get(input.workflow.id, input.idempotencyKey);
      if (existing) {
        this.assertDaemonLeaseFence(input);
        if (!existing.workflow_definition_hash) throw new LegacyWorkflowRunProvenanceError(existing.id);
        if (existing.workflow_definition_hash !== definitionHash) throw new WorkflowRunDefinitionConflictError(existing.id);
        return rowToWorkflowRun(existing);
      }
    }

    const runId = genId();
    const operationEvents = privateOperationEventsForWorkflowRun({
      workflow: input.workflow,
      workflowRunId: runId,
      attempt: input.loopRun?.attempt ?? 1,
      idempotencyKey: input.idempotencyKey ?? `${runId}:${definitionHash}`,
      authority: input.operationAuthority ?? { authorityId: "local", tenantId: "local" },
    });
    const workItem = workItemId ? this.getWorkflowWorkItem(workItemId) : undefined;
    const invocation = invocationId ? this.getWorkflowInvocation(invocationId) : undefined;
    // The manifest is staged as manifest.json.tmp before BEGIN so no
    // filesystem writes happen while the write transaction is open; the temp
    // file is promoted to manifest.json only after COMMIT succeeds.
    const staged = stageWorkflowRunManifest({
      loopsDataDir: this.rootDir,
      workflowRunId: runId,
      workflowId: input.workflow.id,
      workflowName: input.workflow.name,
      invocationId,
      workItemId,
      projectKey: workItem?.projectKey ?? invocation?.scope?.projectPath,
      subjectKind: invocation?.subjectRef.kind ?? (input.loop ? "loop" : "workflow"),
      rawSubjectRef:
        workItem?.subjectRef ??
        invocation?.subjectRef.path ??
        invocation?.subjectRef.id ??
        invocation?.subjectRef.url ??
        input.loop?.name ??
        input.workflow.name,
      payload: {
        workflowInvocation: invocation,
        workflowWorkItem: workItem,
        loopId: input.loop?.id,
        loopRunId: input.loopRun?.id,
        scheduledFor: input.scheduledFor ?? input.loopRun?.scheduledFor,
      },
    });
    const manifestPath = staged.manifestPath;

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.assertDaemonLeaseFence(input, now);
      if (input.idempotencyKey) {
        const existing = this.db
          .query<WorkflowRunRow, [string, string]>(
            "SELECT * FROM workflow_runs WHERE workflow_id = ? AND idempotency_key = ? LIMIT 1",
          )
          .get(input.workflow.id, input.idempotencyKey);
        if (existing) {
          if (!existing.workflow_definition_hash) throw new LegacyWorkflowRunProvenanceError(existing.id);
          if (existing.workflow_definition_hash !== definitionHash) throw new WorkflowRunDefinitionConflictError(existing.id);
          this.db.exec("COMMIT");
          discardWorkflowRunManifest(staged);
          return rowToWorkflowRun(existing);
        }
      }

      this.db
        .query(
          `INSERT INTO workflow_runs (id, workflow_id, workflow_name, loop_id, loop_run_id, invocation_id, work_item_id,
            scheduled_for, idempotency_key, workflow_definition_hash, manifest_path, status, started_at, finished_at, duration_ms, error,
            created_at, updated_at)
           VALUES ($id, $workflowId, $workflowName, $loopId, $loopRunId, $invocationId, $workItemId, $scheduledFor,
            $idempotencyKey, $workflowDefinitionHash, $manifestPath, 'running', $started, NULL, NULL, NULL, $created, $updated)`,
        )
        .run({
          $id: runId,
          $workflowId: input.workflow.id,
          $workflowName: input.workflow.name,
          $loopId: input.loop?.id ?? null,
          $loopRunId: input.loopRun?.id ?? null,
          $invocationId: invocationId ?? null,
          $workItemId: workItemId ?? null,
          $scheduledFor: input.scheduledFor ?? input.loopRun?.scheduledFor ?? null,
          $idempotencyKey: input.idempotencyKey ?? null,
          $workflowDefinitionHash: definitionHash,
          $manifestPath: manifestPath ?? null,
          $started: now,
          $created: now,
          $updated: now,
        });

      if (workItemId) {
        const workItemRes = this.db
          .query(
            `UPDATE workflow_work_items
             SET status='running', workflow_run_id=$workflowRunId, lease_expires_at=$leaseExpiresAt, updated_at=$updated
             WHERE id=$id AND status IN ('admitted', 'queued', 'deferred', 'running')`,
          )
          .run({
            $id: workItemId,
            $workflowRunId: runId,
            $leaseExpiresAt: input.loop ? new Date(Date.now() + input.loop.leaseMs).toISOString() : null,
            $updated: now,
          });
        if (workItemRes.changes !== 1) {
          const current = this.getWorkflowWorkItem(workItemId);
          throw new Error(`workflow work item is not runnable: ${workItemId}${current ? ` status=${current.status}` : ""}`);
        }
      }

      input.workflow.steps.forEach((step, sequence) => {
        const account = step.account ?? step.target.account;
        // codewith agent steps carry their subscription account in `authProfile`
        // (passed to `codewith exec --auth-profile`), not in an AccountRef. Record
        // it as account_profile so per-account attribution and least-loaded pool
        // accounting see the real account instead of NULL.
        const agentTarget = step.target.type === "agent" ? step.target : undefined;
        const resolvedProfile = account?.profile ?? agentTarget?.authProfile ?? null;
        const resolvedTool = account?.tool ?? (agentTarget?.authProfile ? agentTarget.provider : null);
        this.db
          .query(
            `INSERT INTO workflow_step_runs (id, workflow_run_id, step_id, sequence, status, started_at, finished_at,
              exit_code, pid, duration_ms, stdout, stderr, error, account_profile, account_tool, created_at, updated_at)
             VALUES ($id, $workflowRunId, $stepId, $sequence, 'pending', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
              $accountProfile, $accountTool, $created, $updated)`,
          )
          .run({
            $id: genId(),
            $workflowRunId: runId,
            $stepId: step.id,
            $sequence: sequence,
            $accountProfile: resolvedProfile,
            $accountTool: resolvedTool,
            $created: now,
            $updated: now,
          });
      });

      this.db
        .query(
          `INSERT INTO workflow_events (id, workflow_run_id, sequence, event_type, step_id, payload_json, created_at)
           VALUES ($id, $workflowRunId, 1, 'created', NULL, $payload, $created)`,
        )
        .run({
          $id: genId(),
          $workflowRunId: runId,
          $payload: persistedWorkflowEventPayload({
            workflowId: input.workflow.id,
            workflowName: input.workflow.name,
            stepCount: input.workflow.steps.length,
            loopId: input.loop?.id,
            loopRunId: input.loopRun?.id,
            invocationId,
            workItemId,
            manifestPath,
          }),
          $created: now,
        });

      initialContractEvents.forEach((event, index) => {
        input.beforeInitialWorkflowEventPersist?.(event);
        this.db
          .query(
            `INSERT INTO workflow_events (id, workflow_run_id, sequence, event_type, step_id, payload_json, created_at)
             VALUES ($id, $workflowRunId, $sequence, $eventType, $stepId, $payload, $created)`,
          )
          .run({
            $id: genId(),
            $workflowRunId: runId,
            $sequence: index + 2,
            $eventType: event.eventType,
            $stepId: event.stepId,
            $payload: persistedWorkflowEventPayload(event.payload),
            $created: now,
          });
      });

      operationEvents.forEach((event, index) => {
        this.db
          .query(
            `INSERT INTO workflow_events (id, workflow_run_id, sequence, event_type, step_id, payload_json, created_at)
             VALUES ($id, $workflowRunId, $sequence, $eventType, $stepId, $payload, $created)`,
          )
          .run({
            $id: genId(),
            $workflowRunId: runId,
            $sequence: initialContractEvents.length + index + 2,
            $eventType: event.eventType,
            $stepId: event.stepId,
            $payload: persistedWorkflowEventPayload(event.payload),
            $created: now,
          });
      });

      this.db.exec("COMMIT");
      commitWorkflowRunManifest(staged);
      const run = this.getWorkflowRun(runId);
      if (!run) throw new Error(`workflow run not found after create: ${runId}`);
      return run;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      discardWorkflowRunManifest(staged);
      throw error;
    }
  }

  getWorkflowRun(id: string): WorkflowRun | undefined {
    const row = this.db.query<WorkflowRunRow, [string]>("SELECT * FROM workflow_runs WHERE id = ?").get(id);
    return row ? rowToWorkflowRun(row) : undefined;
  }

  requireWorkflowRun(id: string): WorkflowRun {
    const run = this.getWorkflowRun(id);
    if (!run) throw new Error(`workflow run not found: ${id}`);
    return run;
  }

  listWorkflowRuns(opts: { workflowId?: string; loopRunId?: string; limit?: number } = {}): WorkflowRun[] {
    const limit = opts.limit ?? 100;
    let rows: WorkflowRunRow[];
    if (opts.workflowId) {
      rows = this.db
        .query<WorkflowRunRow, [string, number]>(
          "SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY created_at DESC LIMIT ?",
        )
        .all(opts.workflowId, limit);
    } else if (opts.loopRunId) {
      rows = this.db
        .query<WorkflowRunRow, [string, number]>(
          "SELECT * FROM workflow_runs WHERE loop_run_id = ? ORDER BY created_at DESC LIMIT ?",
        )
        .all(opts.loopRunId, limit);
    } else {
      rows = this.db.query<WorkflowRunRow, [number]>("SELECT * FROM workflow_runs ORDER BY created_at DESC LIMIT ?").all(limit);
    }
    return rows.map(rowToWorkflowRun);
  }

  listWorkflowStepRuns(workflowRunId: string): WorkflowStepRun[] {
    const rows = this.db
      .query<WorkflowStepRunRow, [string]>(
        "SELECT * FROM workflow_step_runs WHERE workflow_run_id = ? ORDER BY sequence ASC",
      )
      .all(workflowRunId);
    return rows.map(rowToWorkflowStepRun);
  }

  getWorkflowStepRun(workflowRunId: string, stepId: string): WorkflowStepRun | undefined {
    const row = this.db
      .query<WorkflowStepRunRow, [string, string]>(
        "SELECT * FROM workflow_step_runs WHERE workflow_run_id = ? AND step_id = ?",
      )
      .get(workflowRunId, stepId);
    return row ? rowToWorkflowStepRun(row) : undefined;
  }

  isWorkflowRunTerminal(workflowRunId: string): boolean {
    const run = this.getWorkflowRun(workflowRunId);
    return Boolean(run && ["succeeded", "failed", "timed_out", "cancelled"].includes(run.status));
  }

  startWorkflowStepRun(workflowRunId: string, stepId: string, opts: DaemonLeaseFence = {}): WorkflowStepRun {
    const now = (opts.now ?? new Date()).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const res = this.db
        .query(
          `UPDATE workflow_step_runs
           SET status='running', started_at=$started, finished_at=NULL, exit_code=NULL, duration_ms=NULL,
            pid=NULL, stdout=NULL, stderr=NULL, error=NULL, updated_at=$updated
           WHERE workflow_run_id=$workflowRunId
             AND step_id=$stepId
             AND status IN ('pending', 'failed', 'timed_out')
             AND EXISTS (
               SELECT 1 FROM workflow_runs
               WHERE id=$workflowRunId AND status='running'
             )
             AND ($daemonLeaseId IS NULL OR EXISTS (
               SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
             ))`,
        )
        .run({
          $workflowRunId: workflowRunId,
          $stepId: stepId,
          $started: now,
          $updated: now,
          $daemonLeaseId: opts.daemonLeaseId ?? null,
          $now: now,
        });
      const run = this.getWorkflowStepRun(workflowRunId, stepId);
      if (!run) throw new Error(`workflow step run not found: ${workflowRunId}/${stepId}`);
      if (res.changes !== 1) {
        throw new Error(`workflow step is not claimable: ${workflowRunId}/${stepId} status=${run.status}`);
      }
      this.appendWorkflowEvent(workflowRunId, "step_started", stepId);
      this.db.exec("COMMIT");
      return run;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      throw error;
    }
  }

  markWorkflowStepPid(workflowRunId: string, stepId: string, pid: number, opts: DaemonLeaseFence = {}): WorkflowStepRun {
    const now = (opts.now ?? new Date()).toISOString();
    this.db
      .query(
        `UPDATE workflow_step_runs SET pid=$pid, process_started_at=$processStartedAt, updated_at=$updated
         WHERE workflow_run_id=$workflowRunId AND step_id=$stepId AND status='running'
           AND ($daemonLeaseId IS NULL OR EXISTS (
             SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
           ))`,
      )
      .run({
        $workflowRunId: workflowRunId,
        $stepId: stepId,
        $pid: pid,
        // Pair the pid with its start time so a recycled pid can later be
        // rejected by identity rather than by a lower-bound guess.
        $processStartedAt: isoProcessStart(pid) ?? null,
        $updated: now,
        $daemonLeaseId: opts.daemonLeaseId ?? null,
        $now: now,
      });
    const run = this.getWorkflowStepRun(workflowRunId, stepId);
    if (!run) throw new Error(`workflow step run not found after pid update: ${workflowRunId}/${stepId}`);
    return run;
  }

  recordWorkflowStepProgress(
    workflowRunId: string,
    stepId: string,
    progress: { stdout?: string; stderr?: string; payload?: Record<string, unknown> },
    opts: DaemonLeaseFence = {},
  ): WorkflowStepRun {
    const now = (opts.now ?? new Date()).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const res = this.db
        .query(
          `UPDATE workflow_step_runs
           SET stdout=COALESCE($stdout, stdout),
               stderr=COALESCE($stderr, stderr),
               updated_at=$updated
           WHERE workflow_run_id=$workflowRunId AND step_id=$stepId AND status='running'
             AND ($daemonLeaseId IS NULL OR EXISTS (
               SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
             ))`,
        )
        .run({
          $workflowRunId: workflowRunId,
          $stepId: stepId,
          $stdout: progress.stdout === undefined ? null : persistedRunOutput(progress.stdout),
          $stderr: progress.stderr === undefined ? null : persistedRunOutput(progress.stderr),
          $updated: now,
          $daemonLeaseId: opts.daemonLeaseId ?? null,
          $now: now,
        });
      if (res.changes === 1) {
        this.appendWorkflowEvent(workflowRunId, "step_progress", stepId, progress.payload);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      throw error;
    }
    const run = this.getWorkflowStepRun(workflowRunId, stepId);
    if (!run) throw new Error(`workflow step run not found after progress update: ${workflowRunId}/${stepId}`);
    return run;
  }

  recoverWorkflowRun(
    workflowRunId: string,
    reason = "workflow run recovered for retry",
    _context: WorkflowRecoveryContext = {},
  ): {
    run: WorkflowRun;
    recoveredSteps: WorkflowStepRun[];
  } {
    const scrubbedReason = scrubbedOrNull(reason) ?? "";
    return this.transact(() => {
      const now = nowIso();
      const run = this.requireWorkflowRun(workflowRunId);
      if (run.status !== "running") throw new WorkflowRunNotRunningError();
      const before = this.listWorkflowStepRuns(workflowRunId).filter((step) => step.status === "running");
      const live = before.filter(
        (step) => step.pid !== undefined && isLiveStepProcess(step.pid, step.startedAt, step.processStartedAt),
      );
      if (live.length > 0) {
        throw new WorkflowRunHasLiveStepsError();
      }
      this.db
        .query(
          `UPDATE workflow_step_runs
           SET status='pending', started_at=NULL, finished_at=NULL, exit_code=NULL, pid=NULL, duration_ms=NULL,
            stdout=NULL, stderr=NULL, error=$reason, updated_at=$updated
           WHERE workflow_run_id=$workflowRunId AND status='running'`,
        )
        .run({ $workflowRunId: workflowRunId, $reason: scrubbedReason, $updated: now });
      if (before.length > 0) {
        this.appendWorkflowEvent(workflowRunId, "recovered", undefined, {
          reason: scrubbedReason,
          recoveredSteps: before.map((step) => step.stepId),
        });
      }
      return {
        run,
        recoveredSteps: before.map((step) => this.getWorkflowStepRun(workflowRunId, step.stepId)).filter(Boolean) as WorkflowStepRun[],
      };
    });
  }

  finalizeWorkflowStepRun(
    workflowRunId: string,
    stepId: string,
    patch: Pick<WorkflowStepRun, "status" | "finishedAt" | "durationMs" | "stdout" | "stderr"> &
      Partial<Pick<WorkflowStepRun, "exitCode" | "error">>,
    opts: DaemonLeaseFence = {},
  ): WorkflowStepRun {
    const finishedAt = patch.finishedAt ?? nowIso();
    const error = patch.error === undefined ? undefined : scrubbedOrNull(patch.error) ?? undefined;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const res = this.db
        .query(
          `UPDATE workflow_step_runs SET status=$status, finished_at=$finished, exit_code=$exitCode, duration_ms=$durationMs,
           pid=NULL, stdout=$stdout, stderr=$stderr, error=$error, updated_at=$updated
           WHERE workflow_run_id=$workflowRunId AND step_id=$stepId AND status='running'
             AND ($daemonLeaseId IS NULL OR EXISTS (
               SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
             ))`,
        )
        .run({
          $workflowRunId: workflowRunId,
          $stepId: stepId,
          $status: patch.status,
          $finished: finishedAt,
          $exitCode: patch.exitCode ?? null,
          $durationMs: patch.durationMs ?? null,
          $stdout: persistedRunOutput(patch.stdout),
          $stderr: persistedRunOutput(patch.stderr),
          $error: error ?? null,
          $updated: finishedAt,
          $daemonLeaseId: opts.daemonLeaseId ?? null,
          $now: (opts.now ?? new Date(finishedAt)).toISOString(),
        });
      if (res.changes === 1) {
        this.appendWorkflowEvent(workflowRunId, `step_${patch.status}`, stepId, {
          exitCode: patch.exitCode,
          error,
        });
      }
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      throw error;
    }
    const run = this.getWorkflowStepRun(workflowRunId, stepId);
    if (!run) throw new Error(`workflow step run not found after finalize: ${workflowRunId}/${stepId}`);
    return run;
  }

  skipWorkflowStepRun(workflowRunId: string, stepId: string, reason: string, opts: DaemonLeaseFence = {}): WorkflowStepRun {
    const now = (opts.now ?? new Date()).toISOString();
    const scrubbedReason = scrubbedOrNull(reason) ?? "";
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const res = this.db
        .query(
          `UPDATE workflow_step_runs SET status='skipped', finished_at=$finished, pid=NULL, error=$error, updated_at=$updated
           WHERE workflow_run_id=$workflowRunId AND step_id=$stepId AND status IN ('pending', 'running')
             AND ($daemonLeaseId IS NULL OR EXISTS (
               SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
             ))`,
        )
        .run({
          $workflowRunId: workflowRunId,
          $stepId: stepId,
          $finished: now,
          $error: scrubbedReason,
          $updated: now,
          $daemonLeaseId: opts.daemonLeaseId ?? null,
          $now: now,
        });
      if (res.changes === 1) {
        this.appendWorkflowEvent(workflowRunId, "step_skipped", stepId, { reason: scrubbedReason });
      }
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      throw error;
    }
    const run = this.getWorkflowStepRun(workflowRunId, stepId);
    if (!run) throw new Error(`workflow step run not found after skip: ${workflowRunId}/${stepId}`);
    return run;
  }

  finalizeWorkflowRun(
    workflowRunId: string,
    status: WorkflowRunStatus,
    patch: Partial<Pick<WorkflowRun, "finishedAt" | "durationMs" | "error">> = {},
    opts: DaemonLeaseFence = {},
  ): WorkflowRun {
    const finishedAt = patch.finishedAt ?? nowIso();
    const error = patch.error === undefined ? undefined : scrubbedOrNull(patch.error) ?? undefined;
    let changed = false;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const currentRun = this.db
        .query<WorkflowRunRow, [string]>("SELECT * FROM workflow_runs WHERE id = ?")
        .get(workflowRunId);
      const res = this.db
        .query(
          `UPDATE workflow_runs SET status=$status, finished_at=$finished, duration_ms=$durationMs, error=$error, updated_at=$updated
           WHERE id=$id AND status NOT IN ('succeeded', 'failed', 'timed_out', 'cancelled')
             AND ($daemonLeaseId IS NULL OR EXISTS (
               SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
             ))`,
        )
        .run({
          $id: workflowRunId,
          $status: status,
          $finished: finishedAt,
          $durationMs: patch.durationMs ?? null,
          $error: error ?? null,
          $updated: finishedAt,
          $daemonLeaseId: opts.daemonLeaseId ?? null,
          $now: (opts.now ?? new Date(finishedAt)).toISOString(),
        });
      changed = res.changes === 1;
      if (changed) this.appendWorkflowEvent(workflowRunId, status, undefined, { error });
      if (changed) {
        let itemStatus: WorkflowWorkItemStatus =
          status === "succeeded" ? "succeeded" : status === "cancelled" ? "cancelled" : "failed";
        let preserveActiveParentRetry = false;
        if (
          itemStatus === "failed"
          && currentRun?.loop_id
          && currentRun.loop_run_id
        ) {
          const loop = this.getLoop(currentRun.loop_id);
          const loopRun = this.getRun(currentRun.loop_run_id);
          const workItem = currentRun.work_item_id
            ? this.getWorkflowWorkItem(currentRun.work_item_id)
            : undefined;
          preserveActiveParentRetry = Boolean(
            loop
            && loopRun?.status === "running"
            && workItem?.status === "admitted"
            && workItem.workflowRunId === workflowRunId
            && this.generatedRouteArchiveContext({
              workflowId: currentRun.workflow_id,
              loopId: currentRun.loop_id,
              workItemId: currentRun.work_item_id ?? undefined,
            }),
          );
          if (loop && loopRun && loopRun.attempt < loop.maxAttempts) itemStatus = "admitted";
        }
        const itemReason = itemStatus === "admitted"
          ? error ? `attempt failed; retry pending: ${error}` : "attempt failed; retry pending"
          : error;
        if (!preserveActiveParentRetry) {
          this.setWorkflowWorkItemsForWorkflowRun(workflowRunId, itemStatus, itemReason, finishedAt);
        }
        // A run that finished non-productively (a tempfail retry-signal, or a
        // gate death before the worker ran) must not burn the redispatch cap:
        // refund the attempt, and for a tempfail make the item requeueable now.
        if (itemStatus === "failed" && !preserveActiveParentRetry) {
          this.demoteNonProductiveWorkItems(workflowRunId, finishedAt);
        }
        this.maybeArchiveTerminalGeneratedRouteWorkflow(workflowRunId, finishedAt);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      throw error;
    }
    const run = this.getWorkflowRun(workflowRunId);
    if (!run) throw new Error(`workflow run not found after finalize: ${workflowRunId}`);
    if (changed && status === "succeeded") this.syncSuccessfulTaskLifecycleTodosPointers(workflowRunId);
    void changed;
    return run;
  }

  cancelWorkflowRun(workflowRunId: string, reason = "cancelled by user"): WorkflowRun {
    const now = nowIso();
    const scrubbedReason = scrubbedOrNull(reason) ?? "";
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const run = this.requireWorkflowRun(workflowRunId);
      if (!["succeeded", "failed", "timed_out", "cancelled"].includes(run.status)) {
        this.db
          .query(
            `UPDATE workflow_runs
             SET status='cancelled', finished_at=$finished, error=$reason, updated_at=$updated
             WHERE id=$id AND status NOT IN ('succeeded', 'failed', 'timed_out', 'cancelled')`,
          )
          .run({ $id: workflowRunId, $finished: now, $reason: scrubbedReason, $updated: now });
        this.db
          .query(
            `UPDATE workflow_step_runs
             SET status='cancelled', finished_at=$finished, pid=NULL, error=$reason, updated_at=$updated
             WHERE workflow_run_id=$workflowRunId AND status IN ('pending', 'running')`,
          )
          .run({ $workflowRunId: workflowRunId, $finished: now, $reason: scrubbedReason, $updated: now });
        this.setWorkflowWorkItemsForWorkflowRun(workflowRunId, "cancelled", scrubbedReason, now);
        this.appendWorkflowEvent(workflowRunId, "cancelled", undefined, { reason: scrubbedReason });
        this.maybeArchiveTerminalGeneratedRouteWorkflow(workflowRunId, now);
      }
      this.db.exec("COMMIT");
      return this.requireWorkflowRun(workflowRunId);
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      throw error;
    }
  }

  appendWorkflowEvent(
    workflowRunId: string,
    eventType: string,
    stepId?: string,
    payload?: Record<string, unknown>,
  ): StoredWorkflowEvent {
    // MAX(sequence)+1 is only race-free while the write lock is held, so take
    // a write transaction when the caller has not already opened one.
    return this.transact(() => {
      const now = nowIso();
      if (eventType === "agent_session_contract" || isPrivateOperationEventType(eventType)) {
        const duplicate = stepId === undefined
          ? this.db.query<{ id: string }, [string, string]>(
              "SELECT id FROM workflow_events WHERE workflow_run_id = ? AND event_type = ? AND step_id IS NULL LIMIT 1",
            ).get(workflowRunId, eventType)
          : this.db.query<{ id: string }, [string, string, string]>(
              "SELECT id FROM workflow_events WHERE workflow_run_id = ? AND event_type = ? AND step_id = ? LIMIT 1",
            ).get(workflowRunId, eventType, stepId);
        if (duplicate) throw new DuplicateWorkflowEventError(workflowRunId, eventType, stepId);
      }
      const current = this.db
        .query<{ sequence: number | null }, [string]>("SELECT MAX(sequence) AS sequence FROM workflow_events WHERE workflow_run_id = ?")
        .get(workflowRunId);
      const sequence = (current?.sequence ?? 0) + 1;
      const id = genId();
      this.db
        .query(
          `INSERT INTO workflow_events (id, workflow_run_id, sequence, event_type, step_id, payload_json, created_at)
           VALUES ($id, $workflowRunId, $sequence, $eventType, $stepId, $payload, $created)`,
        )
        .run({
          $id: id,
          $workflowRunId: workflowRunId,
          $sequence: sequence,
          $eventType: eventType,
          $stepId: stepId ?? null,
          $payload: persistedWorkflowEventPayload(payload),
          $created: now,
        });
      const event = this.db.query<WorkflowEventRow, [string]>("SELECT * FROM workflow_events WHERE id = ?").get(id);
      if (!event) throw new Error(`workflow event not found after append: ${id}`);
      return rowToWorkflowEvent(event);
    });
  }

  listWorkflowEvents(workflowRunId: string, limit = 200): StoredWorkflowEvent[] {
    const rows = this.db
      .query<WorkflowEventRow, [string, number]>(
        "SELECT * FROM workflow_events WHERE workflow_run_id = ? ORDER BY sequence ASC LIMIT ?",
      )
      .all(workflowRunId, limit);
    return rows.map(rowToWorkflowEvent);
  }

  hasRunningRun(loopId: string): boolean {
    const row = this.db
      .query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM loop_runs WHERE loop_id = ? AND status = 'running'")
      .get(loopId);
    return (row?.count ?? 0) > 0;
  }

  hasRunningRunForSlot(loopId: string, scheduledFor: string): boolean {
    const row = this.db
      .query<{ count: number }, [string, string]>(
        "SELECT COUNT(*) AS count FROM loop_runs WHERE loop_id = ? AND scheduled_for = ? AND status = 'running'",
      )
      .get(loopId, scheduledFor);
    return (row?.count ?? 0) > 0;
  }

  private hasBlockingRunningRunForOtherSlot(loopId: string, scheduledFor: string, nowIso: string): boolean {
    const rows = this.db
      .query<RunRow, [string, string]>(
        `SELECT * FROM loop_runs
         WHERE loop_id = ? AND scheduled_for <> ? AND status = 'running'`,
      )
      .all(loopId, scheduledFor);
    return rows.some((row) => {
      if (!row.lease_expires_at || row.lease_expires_at > nowIso) return true;
      if (isRecordedProcessAlive(row.pid, row.process_started_at)) return true;
      return this.hasLiveWorkflowStepProcesses(row.id);
    });
  }

  markRunPid(id: string, pid: number, claimedBy?: string, opts: DaemonLeaseFence = {}): LoopRun | undefined {
    const now = (opts.now ?? new Date()).toISOString();
    // Always record the pid's start-time fingerprint alongside it: recovery
    // and the daemon reaper refuse to trust (or signal) unfingerprinted pids,
    // so a bare pid would leave the run unprotected against pid recycling.
    const startedMs = processStartTimeMs(pid);
    const processStartedAt = startedMs === undefined ? null : new Date(startedMs).toISOString();
    const res = claimedBy
      ? this.db
          .query(
            `UPDATE loop_runs SET pid=$pid, process_started_at=$processStartedAt, updated_at=$updated
             WHERE id=$id AND status='running' AND claimed_by=$claimedBy
               AND claim_token=$claimToken
               AND ($daemonLeaseId IS NULL OR EXISTS (
                 SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
               ))`,
          )
          .run({
            $id: id,
            $pid: pid,
            $processStartedAt: processStartedAt,
            $updated: now,
            $claimedBy: claimedBy,
            $claimToken: opts.claimToken ?? null,
            $daemonLeaseId: opts.daemonLeaseId ?? null,
            $now: now,
          })
      : this.db
          .query(
            `UPDATE loop_runs SET pid=$pid, process_started_at=$processStartedAt, updated_at=$updated
             WHERE id=$id AND status='running'
               AND ($daemonLeaseId IS NULL OR EXISTS (
                 SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
               ))`,
          )
          .run({
            $id: id,
            $pid: pid,
            $processStartedAt: processStartedAt,
            $updated: now,
            $daemonLeaseId: opts.daemonLeaseId ?? null,
            $now: now,
          });
    if (res.changes !== 1) return undefined;
    return this.getRun(id);
  }

  /**
   * Record the spawned child's process identity (pid, process group id, start
   * time) so recovery can signal the whole process group later.
   */
  recordRunProcess(runId: string, info: RecordRunProcessInput, opts: DaemonLeaseFence = {}): LoopRun | undefined {
    const now = (opts.now ?? new Date()).toISOString();
    const res = this.db
      .query(
        `UPDATE loop_runs SET pid=$pid, pgid=$pgid, process_started_at=$processStartedAt, updated_at=$updated
         WHERE id=$id AND status='running' AND claim_token=$claimToken
           AND ($daemonLeaseId IS NULL OR EXISTS (
             SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
           ))`,
      )
      .run({
        $id: runId,
        $pid: info.pid,
        $pgid: info.pgid ?? null,
        // Prefer the pid's true start time over "now": the fingerprint must
        // match what the kernel reports later or recovery/reaping distrusts it.
        $processStartedAt: info.processStartedAt ?? isoProcessStart(info.pid) ?? now,
        $updated: now,
        $claimToken: opts.claimToken ?? null,
        $daemonLeaseId: opts.daemonLeaseId ?? null,
        $now: now,
      });
    if (res.changes !== 1) return undefined;
    return this.getRun(runId);
  }

  private hasLiveWorkflowStepProcesses(loopRunId: string): boolean {
    const liveWorkflowSteps = this.db
      .query<
        { workflow_run_id: string; step_id: string; pid: number; started_at: string | null; process_started_at: string | null },
        [string]
      >(
        `SELECT wr.id AS workflow_run_id, wsr.step_id AS step_id, wsr.pid AS pid, wsr.started_at AS started_at,
                wsr.process_started_at AS process_started_at
         FROM workflow_runs wr
         JOIN workflow_step_runs wsr ON wsr.workflow_run_id = wr.id
         WHERE wr.loop_run_id = ?
           AND wr.status NOT IN ('succeeded', 'failed', 'timed_out', 'cancelled')
           AND wsr.status = 'running'
           AND wsr.pid IS NOT NULL`,
      )
      .all(loopRunId);
    return liveWorkflowSteps.some((step) => isLiveStepProcess(step.pid, step.started_at, step.process_started_at));
  }

  createSkippedRun(loop: Loop, scheduledFor: string, reason: string, opts: DaemonLeaseFence = {}): LoopRun {
    const now = nowIso();
    const scrubbedReason = scrubbedOrNull(reason) ?? "";
    const run: LoopRun = {
      id: genId(),
      loopId: loop.id,
      loopName: loop.name,
      scheduledFor,
      attempt: 1,
      status: "skipped",
      finishedAt: now,
      error: scrubbedReason,
      createdAt: now,
      updatedAt: now,
    };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.assertDaemonLeaseFence(opts, now);
      this.db
        .query(
          `INSERT OR IGNORE INTO loop_runs (id, loop_id, loop_name, scheduled_for, attempt, status, started_at, finished_at,
            claimed_by, lease_expires_at, pid, exit_code, duration_ms, stdout, stderr, error, created_at, updated_at)
           VALUES ($id, $loopId, $loopName, $scheduledFor, $attempt, $status, NULL, $finished, NULL, NULL, NULL, NULL, NULL,
            NULL, NULL, $error, $created, $updated)`,
        )
        .run({
          $id: run.id,
          $loopId: run.loopId,
          $loopName: run.loopName,
          $scheduledFor: run.scheduledFor,
          $attempt: run.attempt,
          $status: run.status,
          $finished: run.finishedAt ?? null,
          $error: run.error ?? null,
          $created: run.createdAt,
          $updated: run.updatedAt,
        });
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      throw error;
    }
    return this.getRunBySlot(loop.id, scheduledFor) ?? run;
  }

  getRun(id: string): LoopRun | undefined {
    const row = this.db.query<RunRow, [string]>("SELECT * FROM loop_runs WHERE id = ?").get(id);
    return row ? rowToRun(row) : undefined;
  }

  getRunBySlot(loopId: string, scheduledFor: string): LoopRun | undefined {
    const row = this.db
      .query<RunRow, [string, string]>("SELECT * FROM loop_runs WHERE loop_id = ? AND scheduled_for = ?")
      .get(loopId, scheduledFor);
    return row ? rowToRun(row) : undefined;
  }

  nextRetryableRun(loopId: string, maxAttempts: number, afterScheduledFor?: string): LoopRun | undefined {
    const row = afterScheduledFor
      ? this.db
          .query<RunRow, [string, string, number]>(
            `SELECT * FROM loop_runs
             WHERE loop_id = ? AND scheduled_for > ? AND status IN ('failed', 'timed_out', 'abandoned') AND attempt < ?
             ORDER BY scheduled_for ASC, id ASC LIMIT 1`,
          )
          .get(loopId, afterScheduledFor, maxAttempts)
      : this.db
          .query<RunRow, [string, number]>(
            `SELECT * FROM loop_runs
             WHERE loop_id = ? AND status IN ('failed', 'timed_out', 'abandoned') AND attempt < ?
             ORDER BY scheduled_for ASC, id ASC LIMIT 1`,
          )
          .get(loopId, maxAttempts);
    return row ? rowToRun(row) : undefined;
  }

  claimRun(
    loop: Loop,
    scheduledFor: string,
    runnerId: string,
    now: Date = new Date(),
    opts: DaemonLeaseFence = {},
  ): ClaimRunResult | undefined {
    const startedAt = now.toISOString();
    const claimToken = opts.claimToken ?? genId();

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.assertDaemonLeaseFence(opts, startedAt);
      const currentLoop = this.getLoop(loop.id);
      if (!currentLoop || currentLoop.archivedAt) {
        this.db.exec("COMMIT");
        return undefined;
      }
      loop = currentLoop;
      const leaseExpiresAt = new Date(now.getTime() + loop.leaseMs).toISOString();
      const existing = this.getRunBySlot(loop.id, scheduledFor);
      if (loop.overlap === "skip" && this.hasBlockingRunningRunForOtherSlot(loop.id, scheduledFor, startedAt)) {
        this.db.exec("COMMIT");
        return undefined;
      }

      if (existing) {
        if (existing.status === "running") {
          if (existing.leaseExpiresAt && existing.leaseExpiresAt <= startedAt && isRecordedProcessAlive(existing.pid, existing.processStartedAt)) {
            this.db.exec("COMMIT");
            return undefined;
          }
          if (existing.leaseExpiresAt && existing.leaseExpiresAt <= startedAt && this.hasLiveWorkflowStepProcesses(existing.id)) {
            this.db.exec("COMMIT");
            return undefined;
          }
          const res = this.db
            .query(
              `UPDATE loop_runs SET status='running', started_at=$started, finished_at=NULL,
               claimed_by=$claimedBy, claim_token=$claimToken, lease_expires_at=$lease, pid=NULL, pgid=NULL, process_started_at=NULL, exit_code=NULL,
               duration_ms=NULL, stdout=NULL, stderr=NULL, error=NULL, updated_at=$updated
               WHERE id=$id AND status='running' AND lease_expires_at <= $now`,
            )
            .run({
              $id: existing.id,
              $started: startedAt,
              $claimedBy: runnerId,
              $claimToken: claimToken,
              $lease: leaseExpiresAt,
              $updated: startedAt,
              $now: startedAt,
            });
          this.db.exec("COMMIT");
          if (res.changes !== 1) return undefined;
          const run = this.getRun(existing.id);
          return run ? { run, loop, claimToken } : undefined;
        }

        if (existing.status === "succeeded" || existing.status === "skipped") {
          this.db.exec("COMMIT");
          return undefined;
        }

        const attempt = existing.attempt + 1;
        const res = this.db
          .query(
            `UPDATE loop_runs SET attempt=$attempt, status='running', started_at=$started, finished_at=NULL,
             claimed_by=$claimedBy, claim_token=$claimToken, lease_expires_at=$lease, pid=NULL, pgid=NULL, process_started_at=NULL, exit_code=NULL,
             duration_ms=NULL, stdout=NULL, stderr=NULL, error=NULL, updated_at=$updated
             WHERE id=$id
               AND status IN ('failed', 'timed_out', 'abandoned')
               AND attempt < $maxAttempts`,
          )
          .run({
            $id: existing.id,
            $attempt: attempt,
            $started: startedAt,
            $claimedBy: runnerId,
            $claimToken: claimToken,
            $lease: leaseExpiresAt,
            $updated: startedAt,
            $maxAttempts: loop.maxAttempts,
          });
        this.db.exec("COMMIT");
        if (res.changes !== 1) return undefined;
        const run = this.getRun(existing.id);
        return run ? { run, loop, claimToken } : undefined;
      }

      const id = genId();
      const res = this.db
        .query(
          `INSERT OR IGNORE INTO loop_runs (id, loop_id, loop_name, scheduled_for, attempt, status, started_at, finished_at,
            claimed_by, claim_token, lease_expires_at, pid, exit_code, duration_ms, stdout, stderr, error, created_at, updated_at)
           VALUES ($id, $loopId, $loopName, $scheduledFor, 1, 'running', $started, NULL, $claimedBy, $claimToken, $lease,
            NULL, NULL, NULL, NULL, NULL, NULL, $created, $updated)`,
        )
        .run({
          $id: id,
          $loopId: loop.id,
          $loopName: loop.name,
          $scheduledFor: scheduledFor,
          $started: startedAt,
          $claimedBy: runnerId,
          $claimToken: claimToken,
          $lease: leaseExpiresAt,
          $created: startedAt,
          $updated: startedAt,
        });
      this.db.exec("COMMIT");
      if (res.changes !== 1) return undefined;
      const run = this.getRun(id);
      return run ? { run, loop, claimToken } : undefined;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      throw error;
    }
  }

  finalizeRun(
    id: string,
    patch: Pick<LoopRun, "status" | "finishedAt" | "durationMs" | "stdout" | "stderr"> &
      Partial<Pick<LoopRun, "exitCode" | "error" | "pid">>,
    opts: { claimedBy?: string; now?: Date; daemonLeaseId?: string; claimToken?: string } = {},
  ): LoopRun {
    const error = patch.error === undefined ? undefined : scrubSecrets(patch.error);
    const serverNow = opts.now ?? new Date();
    // The status update and the work-item/workflow cascade must land together.
    return this.transact(() => {
      const current = this.getRun(id);
      if (!current) throw new Error(`run not found after finalize: ${id}`);
      const completion = normalizeRunCompletion({
        startedAt: current.startedAt ?? current.createdAt,
        requestedFinishedAt: patch.finishedAt,
        requestedDurationMs: patch.durationMs,
        serverNow,
      });
      const params = {
        $id: id,
        $status: patch.status,
        $finished: completion.finishedAt,
        $pid: patch.pid ?? null,
        $exitCode: patch.exitCode ?? null,
        $durationMs: completion.durationMs ?? null,
        $stdout: persistedRunOutput(patch.stdout),
        $stderr: persistedRunOutput(patch.stderr),
        $error: error ?? null,
        $updated: completion.updatedAt,
        $claimedBy: opts.claimedBy ?? null,
        $claimToken: opts.claimToken ?? null,
        $now: completion.updatedAt,
        $daemonLeaseId: opts.daemonLeaseId ?? null,
      };
      const res = opts.claimedBy
        ? this.db
            .query(
              `UPDATE loop_runs SET status=$status, finished_at=$finished, lease_expires_at=NULL, pid=$pid, exit_code=$exitCode,
               duration_ms=$durationMs, stdout=$stdout, stderr=$stderr, error=$error, updated_at=$updated
               WHERE id=$id AND status='running' AND claimed_by=$claimedBy AND lease_expires_at > $now
                 AND claim_token=$claimToken
                 AND ($daemonLeaseId IS NULL OR EXISTS (
                   SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
                 ))`,
            )
            .run(params)
        : this.db
            .query(
              // Status-guarded even without a claimedBy fence: an unconditional
              // WHERE id=$id could resurrect an already-terminal run or clobber a
              // run another owner has since re-claimed to 'running'. Only finalize
              // a run that is still running.
              `UPDATE loop_runs SET status=$status, finished_at=$finished, lease_expires_at=NULL, pid=$pid, exit_code=$exitCode,
               duration_ms=$durationMs, stdout=$stdout, stderr=$stderr, error=$error, updated_at=$updated
               WHERE id=$id AND status='running'`,
            )
            .run(params);
      const runRow = this.db.query<RunRow, [string]>("SELECT * FROM loop_runs WHERE id = ?").get(id);
      const run = runRow ? rowToRun(runRow) : undefined;
      if (!run || !runRow) throw new Error(`run not found after finalize: ${id}`);
      if (opts.claimedBy && res.changes !== 1) {
        throw new RunFinalizationConflictError(
          opts.claimToken === undefined || runRow.claim_token !== opts.claimToken
            ? "stale_claim"
            : run.status === "running" ? "stale_claim" : "run_not_running",
          id,
        );
      }
      if (res.changes === 1) {
        this.setWorkflowWorkItemsForLoopRun(run, error, completion.updatedAt);
        const loop = this.getLoop(run.loopId);
        const itemStatus = workItemStatusForLoopRun(run.status, run.attempt, loop?.maxAttempts);
        if (loop?.target.type === "workflow" && itemStatus && itemStatus !== "admitted") {
          const workItemId = loop.target.input?.workflowWorkItemId ?? loop.target.input?.workItemId;
          const workflowRun = this.db
            .query<WorkflowRunRow, [string, string]>(
              `SELECT * FROM workflow_runs
               WHERE loop_run_id = ? AND workflow_id = ?
               ORDER BY created_at DESC, id DESC LIMIT 1`,
            )
            .get(run.id, loop.target.workflowId);
          this.maybeArchiveGeneratedRouteWorkflow({
            workflowId: loop.target.workflowId,
            loopId: loop.id,
            loopRunId: run.id,
            workItemId,
            workflowRunId: workflowRun?.id,
            updated: completion.updatedAt,
          });
        }
      }
      return run;
    });
  }

  heartbeatRunLease(
    id: string,
    claimedBy: string,
    leaseMs: number,
    now: Date = new Date(),
    opts: DaemonLeaseFence = {},
  ): LoopRun | undefined {
    const expiresAt = new Date(now.getTime() + leaseMs).toISOString();
    const res = this.db
      .query(
        // A successful renewal proves the runner is genuinely alive and
        // holding its lease, so the deferral ceiling counts only CONSECUTIVE
        // failures to renew — a run that recovers is not punished for an
        // earlier hiccup.
        `UPDATE loop_runs SET lease_expires_at=$expires, defer_count=0, updated_at=$updated
         WHERE id=$id AND status='running' AND claimed_by=$claimedBy AND lease_expires_at > $now
           AND claim_token=$claimToken
           AND ($daemonLeaseId IS NULL OR EXISTS (
             SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
           ))`,
      )
      .run({
        $id: id,
        $claimedBy: claimedBy,
        $claimToken: opts.claimToken ?? null,
        $expires: expiresAt,
        $updated: now.toISOString(),
        $now: now.toISOString(),
        $daemonLeaseId: opts.daemonLeaseId ?? null,
      });
    if (res.changes !== 1) return undefined;
    return this.getRun(id);
  }

  listRuns(opts: { loopId?: string; status?: RunStatus; labels?: string[]; limit?: number; offset?: number } = {}): LoopRun[] {
    const limit = opts.limit ?? 100;
    const offset = Math.max(0, Math.floor(opts.offset ?? 0));
    const labels = normalizeLoopLabels(opts.labels);
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (opts.loopId) {
      where.push("loop_runs.loop_id = ?");
      params.push(opts.loopId);
    }
    if (opts.status) {
      where.push("loop_runs.status = ?");
      params.push(opts.status);
    }
    for (const label of labels) {
      where.push("EXISTS (SELECT 1 FROM json_each(label_loops.labels_json) WHERE value = ?)");
      params.push(label);
    }
    const join = labels.length ? " JOIN loops AS label_loops ON label_loops.id = loop_runs.loop_id" : "";
    const rows = this.db
      .query<RunRow, Array<string | number>>(
        `SELECT loop_runs.* FROM loop_runs${join}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY loop_runs.created_at DESC, loop_runs.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);
    return rows.map(rowToRun);
  }

  listRecoveredLeaseRunsPage(opts: {
    snapshot?: RecoveredLeaseRunSnapshotEntry[];
    offset?: number;
    limit?: number;
  } = {}): RecoveredLeaseRunPage {
    const limit = Math.max(1, Math.min(1_000, Math.floor(opts.limit ?? 1_000)));
    const snapshot = opts.snapshot ?? this.db
      .query<Pick<RunRow, "id" | "updated_at" | "scheduled_for" | "attempt">, []>(
        `SELECT id, updated_at, scheduled_for, attempt FROM loop_runs
         WHERE status='abandoned' AND error='run lease expired before completion'
         ORDER BY updated_at ASC, scheduled_for ASC, id ASC`,
      )
      .all()
      .map((row) => ({
        id: row.id,
        updatedAt: row.updated_at,
        scheduledFor: row.scheduled_for,
        attempt: row.attempt,
      }));
    const offset = Math.max(0, Math.min(snapshot.length, Math.floor(opts.offset ?? 0)));
    const selected = snapshot.slice(offset, offset + limit);
    const rows = selected.length === 0
      ? []
      : this.db
          .query<RunRow, string[]>(
            `SELECT * FROM loop_runs WHERE id IN (${selected.map(() => "?").join(",")})`,
          )
          .all(...selected.map((entry) => entry.id));
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    const snapshotById = new Map(selected.map((entry) => [entry.id, entry]));
    const runs = selected
      .map((entry) => rowsById.get(entry.id))
      .filter((row): row is RunRow => {
        if (!row) return false;
        const entry = snapshotById.get(row.id);
        return Boolean(
          entry &&
          row.status === "abandoned" &&
          row.error === "run lease expired before completion" &&
          row.attempt === entry.attempt &&
          row.updated_at === entry.updatedAt &&
          row.scheduled_for === entry.scheduledFor
        );
      })
      .map(rowToRun);
    const nextOffset = offset + selected.length;
    return {
      runs,
      snapshot,
      ...(nextOffset < snapshot.length ? { nextOffset } : {}),
    };
  }

  // ── loop bundles / revisions ───────────────────────────────────────────────

  /**
   * Claim the bundle namespace key for a loop.
   *
   * The unique index on `bundle_name` is what makes an S3 prefix and a CLI
   * argument resolve to exactly one loop even though `loops.name` is not
   * unique. A name already held by a DIFFERENT loop is a conflict, not a
   * silent takeover — the loser would otherwise start pushing versions into
   * the winner's history.
   */
  setLoopBundleName(loopId: string, bundleName: string, opts: { now?: Date } = {}): Loop {
    const updated = (opts.now ?? new Date()).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const loop = this.getLoop(loopId);
      if (!loop) throw new LoopNotFoundError(loopId);
      if (loop.archivedAt) throw new LoopArchivedError(loop.name || loopId);
      const holder = this.db
        .query<{ id: string }, [string]>("SELECT id FROM loops WHERE bundle_name = ?")
        .get(bundleName);
      if (holder && holder.id !== loopId) {
        throw new BundleNameTakenError(bundleName, holder.id);
      }
      this.db.query("UPDATE loops SET bundle_name=?, updated_at=? WHERE id=?").run(bundleName, updated, loopId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.requireLoop(loopId);
  }

  /** Pin a loop to one bundle version, or `null` to follow latest. */
  setLoopBundlePin(loopId: string, version: number | null, opts: { now?: Date } = {}): Loop {
    const updated = (opts.now ?? new Date()).toISOString();
    const loop = this.getLoop(loopId);
    if (!loop) throw new LoopNotFoundError(loopId);
    if (version !== null && !this.getLoopRevision(loopId, version)) {
      // Pinning a version that does not exist is the kind of error that only
      // shows up at 3am on a runner that can no longer materialise anything.
      throw new LoopVersionNotFoundError(loopId, version);
    }
    this.db.query("UPDATE loops SET bundle_pinned_version=?, updated_at=? WHERE id=?").run(version, updated, loopId);
    return this.requireLoop(loopId);
  }

  findLoopByBundleName(bundleName: string): Loop | undefined {
    const row = this.db.query<LoopRow, [string]>("SELECT * FROM loops WHERE bundle_name = ?").get(bundleName);
    return row ? rowToLoop(row) : undefined;
  }

  /**
   * Append a revision, allocating its version inside the same transaction.
   *
   * `version = MAX(version) + 1` under `BEGIN IMMEDIATE` and a unique index, so
   * two concurrent pushes get two versions and neither overwrites the other.
   * The caller writes the objects AFTER this returns, using the storage key it
   * recorded here: a crash then leaves a row whose objects are missing (loud,
   * reported as `incomplete`) rather than an object no row references.
   */
  createLoopRevision(input: CreateLoopRevisionInput, opts: { now?: Date } = {}): LoopRevision {
    const createdAt = (opts.now ?? new Date()).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const loop = this.getLoop(input.loopId);
      if (!loop) throw new LoopNotFoundError(input.loopId);
      if (loop.archivedAt) throw new LoopArchivedError(loop.name || input.loopId);
      const head = this.db
        .query<{ version: number | null }, [string]>("SELECT MAX(version) AS version FROM loop_revisions WHERE loop_id = ?")
        .get(input.loopId);
      const version = (head?.version ?? 0) + 1;
      this.db
        .query(
          `INSERT INTO loop_revisions (loop_id, version, bundle_name, bundle_digest, archive_sha256, archive_bytes,
             storage_kind, storage_key, manifest_json, loop_json, carries_prompt, author, source_station, source_agent,
             reason, rolled_back_from, created_at)
           VALUES ($loopId, $version, $bundleName, $bundleDigest, $archiveSha256, $archiveBytes,
             $storageKind, $storageKey, $manifestJson, $loopJson, $carriesPrompt, $author, $sourceStation, $sourceAgent,
             $reason, $rolledBackFrom, $createdAt)`,
        )
        .run({
          $loopId: input.loopId,
          $version: version,
          $bundleName: input.bundleName,
          $bundleDigest: input.bundleDigest,
          $archiveSha256: input.archiveSha256,
          $archiveBytes: input.archiveBytes,
          $storageKind: input.storageKind,
          $storageKey: input.storageKeyFor?.(version) ?? input.storageKey ?? null,
          $manifestJson: JSON.stringify(input.manifest ?? {}),
          $loopJson: JSON.stringify(input.loopJson),
          $carriesPrompt: input.carriesPrompt ? 1 : 0,
          $author: input.author,
          $sourceStation: input.sourceStation ?? null,
          $sourceAgent: input.sourceAgent ?? null,
          $reason: input.reason ?? null,
          $rolledBackFrom: input.rolledBackFrom ?? null,
          $createdAt: createdAt,
        });
      this.db.query("UPDATE loops SET bundle_name=?, updated_at=? WHERE id=?").run(input.bundleName, createdAt, input.loopId);
      this.db.exec("COMMIT");
      const created = this.getLoopRevision(input.loopId, version);
      if (!created) throw new Error(`loop revision missing after insert: ${input.loopId}@${version}`);
      return created;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getLoopRevision(loopId: string, version: number): LoopRevision | undefined {
    const row = this.db
      .query<LoopRevisionRow, [string, number]>("SELECT * FROM loop_revisions WHERE loop_id = ? AND version = ?")
      .get(loopId, version);
    return row ? rowToLoopRevision(row) : undefined;
  }

  latestLoopRevision(loopId: string): LoopRevision | undefined {
    const row = this.db
      .query<LoopRevisionRow, [string]>("SELECT * FROM loop_revisions WHERE loop_id = ? ORDER BY version DESC LIMIT 1")
      .get(loopId);
    return row ? rowToLoopRevision(row) : undefined;
  }

  /**
   * The head revision carrying `bundleDigest`, if any.
   *
   * This is what makes a re-push of an unchanged tree idempotent: the content
   * digest is framing-independent, so an identical tree packed on another
   * machine at another time still finds its existing revision instead of
   * allocating a duplicate version.
   */
  findLoopRevisionByDigest(loopId: string, bundleDigest: string): LoopRevision | undefined {
    const row = this.db
      .query<LoopRevisionRow, [string, string]>(
        "SELECT * FROM loop_revisions WHERE loop_id = ? AND bundle_digest = ? ORDER BY version DESC LIMIT 1",
      )
      .get(loopId, bundleDigest);
    return row ? rowToLoopRevision(row) : undefined;
  }

  listLoopRevisions(loopId: string, opts: { limit?: number; offset?: number } = {}): { revisions: LoopRevision[]; total: number } {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    const rows = this.db
      .query<LoopRevisionRow, [string, number, number]>(
        "SELECT * FROM loop_revisions WHERE loop_id = ? ORDER BY version DESC LIMIT ? OFFSET ?",
      )
      .all(loopId, limit, offset);
    const total = this.db
      .query<{ total: number }, [string]>("SELECT COUNT(*) AS total FROM loop_revisions WHERE loop_id = ?")
      .get(loopId)?.total ?? 0;
    return { revisions: rows.map(rowToLoopRevision), total };
  }

  /** Tenant-wide bundle index. `machine` is what `sync --for-machine` filters on. */
  listLoopBundles(opts: { machine?: string; limit?: number; offset?: number } = {}): { bundles: LoopBundleSummary[]; total: number } {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const offset = Math.max(opts.offset ?? 0, 0);
    const rows = this.db
      .query<LoopRow, []>("SELECT * FROM loops WHERE bundle_name IS NOT NULL ORDER BY bundle_name ASC")
      .all()
      .map(rowToLoop)
      .filter((loop) => (opts.machine ? loop.machine?.id === opts.machine : true));
    const page = rows.slice(offset, offset + limit);
    return {
      bundles: page.map((loop) => {
        const head = this.latestLoopRevision(loop.id);
        return {
          bundleName: loop.bundleName!,
          loopId: loop.id,
          loopName: loop.name,
          latestVersion: head?.version ?? 0,
          ...(loop.bundlePinnedVersion === undefined ? {} : { pinnedVersion: loop.bundlePinnedVersion }),
          ...(head?.bundleDigest === undefined ? {} : { bundleDigest: head.bundleDigest }),
          carriesPrompt: head?.carriesPrompt ?? false,
          ...(loop.machine?.id === undefined ? {} : { machineId: loop.machine.id }),
          updatedAt: head?.createdAt ?? loop.updatedAt,
        };
      }),
      total: rows.length,
    };
  }

  writeRunReceipt(input: WriteRunReceiptInput, opts: { now?: Date } = {}): RunReceipt {
    const inputRunId = typeof input.run_id === "string" && input.run_id.trim() ? input.run_id : undefined;
    const existing = inputRunId ? this.getRunReceipt(inputRunId) : undefined;
    const run = inputRunId ? this.getRun(inputRunId) : undefined;
    const loop = input.loop_id ? this.getLoop(input.loop_id) : run ? this.getLoop(run.loopId) : undefined;
    const receipt = normalizeRunReceipt(input, { now: opts.now, run, loop, existing });
    this.db
      .query(
        `INSERT INTO run_receipts (run_id, loop_id, machine_json, repo, task_ids_json, knowledge_ids_json, digest_id,
          started_at, finished_at, status, exit_code, summary_json, evidence_paths_json, bundle_json, created_at, updated_at)
         VALUES ($runId, $loopId, $machineJson, $repo, $taskIdsJson, $knowledgeIdsJson, $digestId,
          $startedAt, $finishedAt, $status, $exitCode, $summaryJson, $evidencePathsJson, $bundleJson, $createdAt, $updatedAt)
         ON CONFLICT(run_id) DO UPDATE SET
          loop_id=excluded.loop_id,
          machine_json=excluded.machine_json,
          repo=excluded.repo,
          task_ids_json=excluded.task_ids_json,
          knowledge_ids_json=excluded.knowledge_ids_json,
          digest_id=excluded.digest_id,
          started_at=excluded.started_at,
          finished_at=excluded.finished_at,
          status=excluded.status,
          exit_code=excluded.exit_code,
          summary_json=excluded.summary_json,
          evidence_paths_json=excluded.evidence_paths_json,
          bundle_json=excluded.bundle_json,
          updated_at=excluded.updated_at`,
      )
      .run({
        $runId: receipt.run_id,
        $loopId: receipt.loop_id,
        $machineJson: JSON.stringify(receipt.machine),
        $repo: receipt.repo,
        $taskIdsJson: JSON.stringify(receipt.task_ids),
        $knowledgeIdsJson: JSON.stringify(receipt.knowledge_ids),
        $digestId: receipt.digest_id,
        $startedAt: receipt.started_at,
        $finishedAt: receipt.finished_at,
        $status: receipt.status,
        $exitCode: receipt.exit_code,
        $summaryJson: JSON.stringify(receipt.summary),
        $evidencePathsJson: JSON.stringify(receipt.evidence_paths),
        $bundleJson: receipt.bundle ? JSON.stringify(receipt.bundle) : null,
        $createdAt: receipt.created_at,
        $updatedAt: receipt.updated_at,
      });
    return this.getRunReceipt(receipt.run_id) ?? receipt;
  }

  getRunReceipt(runId: string): RunReceipt | undefined {
    const row = this.db.query<RunReceiptRow, [string]>("SELECT * FROM run_receipts WHERE run_id = ?").get(runId);
    return row ? rowToRunReceipt(row) : undefined;
  }

  listRunReceipts(opts: { loopId?: string; repo?: string; taskId?: string; knowledgeId?: string; status?: string; limit?: number } = {}): RunReceipt[] {
    const limit = opts.limit ?? 100;
    const filters: string[] = [];
    const params: unknown[] = [];
    if (opts.loopId) {
      filters.push("loop_id = ?");
      params.push(opts.loopId);
    }
    if (opts.repo) {
      filters.push("repo = ?");
      params.push(opts.repo);
    }
    if (opts.status) {
      filters.push("status = ?");
      params.push(opts.status);
    }
    if (opts.taskId) {
      filters.push("EXISTS (SELECT 1 FROM json_each(run_receipts.task_ids_json) WHERE value = ?)");
      params.push(opts.taskId);
    }
    if (opts.knowledgeId) {
      filters.push("EXISTS (SELECT 1 FROM json_each(run_receipts.knowledge_ids_json) WHERE value = ?)");
      params.push(opts.knowledgeId);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const rows = this.db
      .query<RunReceiptRow, any>(`SELECT * FROM run_receipts ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...params, limit);
    return rows.map(rowToRunReceipt);
  }

  private deferLiveExpiredRun(id: string, now: Date, opts: DaemonLeaseFence = {}): void {
    const updated = now.toISOString();
    const deferredUntil = new Date(now.getTime() + LIVE_EXPIRED_RUN_GRACE_MS).toISOString();
    this.db
      .query(
        `UPDATE loop_runs SET lease_expires_at=$deferredUntil, defer_count=defer_count+1, updated_at=$updated
         WHERE id=$id AND status='running' AND lease_expires_at <= $now
           AND ($daemonLeaseId IS NULL OR EXISTS (
             SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
           ))`,
      )
      .run({
        $id: id,
        $deferredUntil: deferredUntil,
        $updated: updated,
        $now: updated,
        $daemonLeaseId: opts.daemonLeaseId ?? null,
      });
  }

  recoverExpiredRunLeases(
    now: Date = new Date(),
    opts: DaemonLeaseFence & {
      limit?: number;
      scanLimit?: number;
      runId?: string;
      expectedLeaseExpiresAt?: string;
      expectedUpdatedAt?: string;
    } = {},
  ): LoopRun[] {
    return this.recoverExpiredRunLeasesDetailed(now, opts).abandoned;
  }

  listExpiredRunLeaseCandidates(
    expiredBefore: Date = new Date(),
    opts: { limit?: number } = {},
  ): ExpiredRunLeaseCandidatePage {
    const limit = Math.max(1, Math.min(1_000, Math.floor(opts.limit ?? DEFAULT_RECOVERY_BATCH_LIMIT)));
    const rows = this.db
      .query<RunRow, [string, number]>(
        `SELECT * FROM loop_runs
         WHERE status = 'running' AND lease_expires_at <= ?
         ORDER BY lease_expires_at ASC, id ASC
         LIMIT ?`,
      )
      .all(expiredBefore.toISOString(), limit + 1);
    return {
      candidates: rows.slice(0, limit).map((row) => ({
        runId: row.id,
        loopId: row.loop_id,
        leaseExpiresAt: row.lease_expires_at!,
        updatedAt: row.updated_at,
      })),
      truncated: rows.length > limit,
    };
  }

  /**
   * Read-only counterpart to {@link recoverExpiredRunLeasesDetailed}: runs the
   * identical SELECT and the identical two-part classification — liveness
   * (`isRecordedProcessAlive` / `hasLiveWorkflowStepProcesses`) AND the
   * `defer_count` grace ceiling (`MAX_LIVE_EXPIRED_RUN_DEFERRALS`) — but issues
   * no UPDATE. `reclaimable` is exactly the set a same-parameters call to
   * `recoverExpiredRunLeasesDetailed` (without `preserveLiveProcesses`) would
   * mark abandoned: dead now, OR alive but already past the grace ceiling.
   * `liveDeferred` is exactly the set it would instead defer: alive AND still
   * under the ceiling.
   *
   * CORRECTED (P1, PR #182 review; superseded fix in #182 itself did not
   * address this — see hygiene.ts `buildStuckRunReport` for the paired half).
   * This previously classified any row that "looks alive" as `liveDeferred`
   * unconditionally, ignoring `defer_count` entirely. Because callers gate the
   * real mutating call on `reclaimable.length > 0`, that made a live-looking
   * run's grace-ceiling escalation permanently unreachable —
   * `recoverExpiredRunLeasesDetailed`, the only place `defer_count` is ever
   * incremented, was never invoked for such a run, so it sat at
   * `defer_count=0` forever rather than ever accumulating toward the ceiling
   * and being abandoned. Reusing the exact
   * `looksAlive && deferralsSoFar < MAX_LIVE_EXPIRED_RUN_DEFERRALS` predicate
   * (not a re-derived one) is what keeps this method from drifting from
   * `recoverExpiredRunLeasesDetailed` again.
   */
  previewExpiredRunLeases(
    now: Date = new Date(),
    opts: { limit?: number; scanLimit?: number; runId?: string } = {},
  ): { reclaimable: LoopRun[]; liveDeferred: LoopRun[] } {
    const limit = Math.max(1, Math.min(1_000, Math.floor(opts.limit ?? DEFAULT_RECOVERY_BATCH_LIMIT)));
    const scanLimit = Math.max(limit, Math.min(5_000, Math.floor(opts.scanLimit ?? limit * DEFAULT_RECOVERY_SCAN_MULTIPLIER)));
    const rows = this.db
      .query<RunRow, [string, string | null, string | null, number]>(
        `SELECT * FROM loop_runs
         WHERE status = 'running' AND lease_expires_at <= ?
           AND (? IS NULL OR id = ?)
         ORDER BY lease_expires_at ASC
         LIMIT ?`,
      )
      .all(now.toISOString(), opts.runId ?? null, opts.runId ?? null, scanLimit);
    const reclaimable: LoopRun[] = [];
    const liveDeferred: LoopRun[] = [];
    for (const row of rows) {
      if (reclaimable.length >= limit) break;
      const run = this.getRun(row.id);
      if (!run) continue;
      const looksAlive = isRecordedProcessAlive(row.pid, row.process_started_at) || this.hasLiveWorkflowStepProcesses(row.id);
      const deferralsSoFar = row.defer_count ?? 0;
      if (looksAlive && deferralsSoFar < MAX_LIVE_EXPIRED_RUN_DEFERRALS) {
        liveDeferred.push(run);
        continue;
      }
      reclaimable.push(run);
    }
    return { reclaimable, liveDeferred };
  }

  /**
   * Recover expired run leases and report both outcomes: runs abandoned (no
   * live process) and runs deferred because their process (group) is still
   * alive. Entries carry pid/pgid/processStartedAt so the daemon can signal
   * orphaned process groups (SIGTERM then SIGKILL) after recovery.
   */
  recoverExpiredRunLeasesDetailed(
    now: Date = new Date(),
    opts: DaemonLeaseFence & {
      limit?: number;
      scanLimit?: number;
      runId?: string;
      expectedLeaseExpiresAt?: string;
      expectedUpdatedAt?: string;
      refuseAdmittedPrivateOperations?: boolean;
      excludeClaimedBy?: string;
      /**
       * Leave one runner's runs untouched, but only within an explicit set of
       * loops. Unlike `excludeClaimedBy`, which protects everything a runner
       * owns unconditionally, this protects only the loops the caller has
       * established are still recoverable by other means (for Loops: loops a
       * poll never examined, whose runs that runner is about to take over on
       * its next poll). A runner's own run on a loop that WAS examined is not
       * recoverable by takeover, so blanket-excluding it strands it in
       * `running` with a dead lease indefinitely.
       *
       * Expressed as a loop-id set rather than a run-id set on purpose: a
       * run-id set has to be enumerated by the caller, which both caps
       * silently at one page and costs a query per loop. It is applied inside
       * the scan query, BEFORE `LIMIT`, so protected rows never consume the
       * scan window and starve an unrelated reapable run.
       */
      protectClaimedByInLoops?: { claimedBy: string; loopIds: readonly string[] };
      /** Leave every currently live process untouched, even after the daemon recovery grace ceiling. */
      preserveLiveProcesses?: boolean;
    } = {},
  ): RecoverExpiredRunLeasesResult {
    const limit = Math.max(1, Math.min(1_000, Math.floor(opts.limit ?? DEFAULT_RECOVERY_BATCH_LIMIT)));
    const scanLimit = Math.max(limit, Math.min(5_000, Math.floor(opts.scanLimit ?? limit * DEFAULT_RECOVERY_SCAN_MULTIPLIER)));
    // Capacity protection is part of the QUERY, not a post-scan filter: rows
    // discarded after `LIMIT` have already consumed the scan window, so a large
    // protected set would crowd out an unrelated expired run and — because the
    // caller rebuilds the same protected set on every poll — starve it
    // permanently rather than transiently.
    const protect = opts.protectClaimedByInLoops;
    const protectLoopIds = protect ? [...new Set(protect.loopIds)] : [];
    // `claimed_by IS NULL` first: an unclaimed row must stay reapable, and a
    // bare `claimed_by <> ?` is NULL (not true) for those rows.
    const protectClause = protectLoopIds.length > 0
      ? ` AND (claimed_by IS NULL OR claimed_by <> ? OR loop_id NOT IN (${protectLoopIds.map(() => "?").join(",")}))`
      : "";
    const unresolvedOperationPredicate = `EXISTS (
      SELECT 1
      FROM workflow_runs AS operation_workflow
      JOIN workflow_events AS admitted_event
        ON admitted_event.workflow_run_id = operation_workflow.id
      WHERE operation_workflow.loop_run_id = loop_runs.id
        AND admitted_event.event_type = 'private_operation_admitted'
        AND NOT EXISTS (
          SELECT 1
          FROM workflow_events AS terminal_event
          WHERE terminal_event.workflow_run_id = admitted_event.workflow_run_id
            AND terminal_event.step_id = admitted_event.step_id
            AND terminal_event.event_type = 'private_operation_terminal'
        )
    )`;
    const candidateArgs = [
      now.toISOString(),
      opts.runId ?? null,
      opts.runId ?? null,
      opts.expectedLeaseExpiresAt ?? null,
      opts.expectedLeaseExpiresAt ?? null,
      opts.expectedUpdatedAt ?? null,
      opts.expectedUpdatedAt ?? null,
      opts.excludeClaimedBy ?? null,
      opts.excludeClaimedBy ?? null,
      ...(protectLoopIds.length > 0 ? [protect!.claimedBy, ...protectLoopIds] : []),
    ];
    const operationRows = opts.refuseAdmittedPrivateOperations
      ? this.db
          .query<RunRow, Array<string | number | null>>(
            `SELECT * FROM loop_runs
             WHERE status = 'running' AND lease_expires_at <= ?
               AND (? IS NULL OR id = ?)
               AND (? IS NULL OR lease_expires_at = ?)
               AND (? IS NULL OR updated_at = ?)
               AND (? IS NULL OR claimed_by IS NULL OR claimed_by <> ?)
               AND ${unresolvedOperationPredicate}${protectClause}
             ORDER BY lease_expires_at ASC
             LIMIT ?`,
          )
          .all(...candidateArgs, limit)
      : [];
    const operationReconciliationRequired: LoopRun[] = operationRows
      .map((row) => this.getRun(row.id))
      .filter((run): run is LoopRun => Boolean(run));
    const reconciliationRunIds = new Set(operationReconciliationRequired.map((run) => run.id));
    const requiresOperationReconciliation = (runId: string): boolean => Boolean(
      this.db.query<{ found: number }, [string, string]>(
        `SELECT 1 AS found FROM loop_runs
         WHERE id = ? AND status = 'running' AND lease_expires_at <= ?
           AND ${unresolvedOperationPredicate}
         LIMIT 1`,
      ).get(runId, now.toISOString()),
    );
    const rows = this.db
      .query<RunRow, Array<string | number | null>>(
        `SELECT * FROM loop_runs
         WHERE status = 'running' AND lease_expires_at <= ?
           AND (? IS NULL OR id = ?)
           AND (? IS NULL OR lease_expires_at = ?)
           AND (? IS NULL OR updated_at = ?)
           AND (? IS NULL OR claimed_by IS NULL OR claimed_by <> ?)
           AND (? = 0 OR NOT ${unresolvedOperationPredicate})${protectClause}
         ORDER BY lease_expires_at ASC
         LIMIT ?`,
      )
      .all(
        ...candidateArgs.slice(0, 9),
        opts.refuseAdmittedPrivateOperations ? 1 : 0,
        ...(protectLoopIds.length > 0 ? [protect!.claimedBy, ...protectLoopIds] : []),
        scanLimit,
      );
    const recovered: LoopRun[] = [];
    const deferred: LoopRun[] = [];
    for (const row of rows) {
      if (recovered.length >= limit) break;
      const looksAlive = isRecordedProcessAlive(row.pid, row.process_started_at) || this.hasLiveWorkflowStepProcesses(row.id);
      // "Looks alive" only buys a BOUNDED grace. Past the ceiling the run is
      // abandoned regardless: an expired lease that keeps failing to renew is
      // a wedged runner (or a pid the OS recycled under us), and deferring it
      // forever blocks every run queued behind it.
      const deferralsSoFar = row.defer_count ?? 0;
      if (looksAlive && opts.preserveLiveProcesses) {
        const deferredRun = this.getRun(row.id);
        if (deferredRun) deferred.push(deferredRun);
        continue;
      }
      if (looksAlive && deferralsSoFar < MAX_LIVE_EXPIRED_RUN_DEFERRALS) {
        this.deferLiveExpiredRun(row.id, now, opts);
        const deferredRun = this.getRun(row.id);
        if (deferredRun) deferred.push(deferredRun);
        continue;
      }
      const exhaustedGrace = looksAlive;
      const abandonError = exhaustedGrace
        ? `run lease expired and exceeded the live-process deferral ceiling (${MAX_LIVE_EXPIRED_RUN_DEFERRALS} deferrals, ${Math.round((MAX_LIVE_EXPIRED_RUN_DEFERRALS * LIVE_EXPIRED_RUN_GRACE_MS) / 60_000)}m grace); the recorded process still appears alive but never renewed its lease`
        : "run lease expired before completion";
      const finished = now.toISOString();
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const res = this.db
          .query(
            `UPDATE loop_runs SET status='abandoned', finished_at=$finished, lease_expires_at=NULL,
             error=$abandonError, updated_at=$updated
             WHERE id=$id AND status='running' AND lease_expires_at <= $now
               AND ($expectedLeaseExpiresAt IS NULL OR lease_expires_at=$expectedLeaseExpiresAt)
               AND ($expectedUpdatedAt IS NULL OR updated_at=$expectedUpdatedAt)
               AND ($daemonLeaseId IS NULL OR EXISTS (
                 SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
               ))
               AND ($refuseAdmittedPrivateOperations = 0 OR NOT ${unresolvedOperationPredicate})`,
          )
          .run({
            $id: row.id,
            $finished: finished,
            $updated: finished,
            $now: finished,
            $abandonError: abandonError,
            $expectedLeaseExpiresAt: opts.expectedLeaseExpiresAt ?? null,
            $expectedUpdatedAt: opts.expectedUpdatedAt ?? null,
            $daemonLeaseId: opts.daemonLeaseId ?? null,
            $refuseAdmittedPrivateOperations: opts.refuseAdmittedPrivateOperations ? 1 : 0,
          });
        if (res.changes !== 1) {
          this.db.exec("COMMIT");
          if (
            opts.refuseAdmittedPrivateOperations &&
            !reconciliationRunIds.has(row.id) &&
            requiresOperationReconciliation(row.id)
          ) {
            const unchanged = this.getRun(row.id);
            if (unchanged) {
              operationReconciliationRequired.push(unchanged);
              reconciliationRunIds.add(unchanged.id);
            }
          }
          continue;
        }
        const workflowRows = this.db
          .query<WorkflowRunRow, [string]>(
            "SELECT * FROM workflow_runs WHERE loop_run_id = ? AND status NOT IN ('succeeded', 'failed', 'timed_out', 'cancelled')",
          )
          .all(row.id);
        for (const workflowRow of workflowRows) {
          const workflowRes = this.db
            .query(
              `UPDATE workflow_runs
               SET status='failed', finished_at=$finished, error='parent loop run lease expired before completion', updated_at=$updated
               WHERE id=$id AND status NOT IN ('succeeded', 'failed', 'timed_out', 'cancelled')
                 AND ($daemonLeaseId IS NULL OR EXISTS (
                   SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
                 ))`,
            )
            .run({
              $id: workflowRow.id,
              $finished: finished,
              $updated: finished,
              $now: finished,
              $daemonLeaseId: opts.daemonLeaseId ?? null,
            });
          if (workflowRes.changes !== 1) continue;
          this.db
            .query(
              `UPDATE workflow_step_runs
               SET status='skipped', finished_at=$finished, pid=NULL, error='parent loop run lease expired before completion', updated_at=$updated
               WHERE workflow_run_id=$workflowRunId AND status IN ('pending', 'running')
                 AND ($daemonLeaseId IS NULL OR EXISTS (
                   SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
                 ))`,
            )
            .run({
              $workflowRunId: workflowRow.id,
              $finished: finished,
              $updated: finished,
              $now: finished,
              $daemonLeaseId: opts.daemonLeaseId ?? null,
            });
          this.appendWorkflowEvent(workflowRow.id, "failed", undefined, {
            error: "parent loop run lease expired before completion",
            loopRunId: row.id,
          });
          this.setWorkflowWorkItemsForWorkflowRun(workflowRow.id, "failed", "parent loop run lease expired before completion", finished);
        }
        const loop = this.getLoop(row.loop_id);
        const itemStatus = workItemStatusForLoopRun("abandoned", row.attempt, loop?.maxAttempts);
        if (itemStatus) {
          const statuses: WorkflowWorkItemStatus[] = itemStatus === "admitted"
            ? ["admitted", "running", "failed"]
            : ["admitted", "running"];
          const reason = itemStatus === "admitted"
            ? "run lease expired before completion; retry pending"
            : "run lease expired before completion";
          this.setWorkflowWorkItemsForLoop(row.loop_id, itemStatus, reason, finished, statuses);
          if (loop?.target.type === "workflow" && itemStatus !== "admitted") {
            const workflowId = loop.target.workflowId;
            const workItemId = loop.target.input?.workflowWorkItemId ?? loop.target.input?.workItemId;
            this.maybeArchiveGeneratedRouteWorkflow({
              workflowId,
              loopId: loop.id,
              loopRunId: row.id,
              workItemId,
              workflowRunId: workflowRows.find((workflowRow) => workflowRow.workflow_id === workflowId)?.id,
              updated: finished,
            });
          }
        }
        this.db.exec("COMMIT");
      } catch (error) {
        try {
          this.db.exec("ROLLBACK");
        } catch {
          /* transaction may already be closed */
        }
        throw error;
      }
      const run = this.getRun(row.id);
      if (run) recovered.push(run);
    }
    return { abandoned: recovered, deferred, operationReconciliationRequired };
  }

  /**
   * Atomically transition a loop to "expired" after N consecutive successful
   * runs and write the expiry marker run (status "skipped", error = reason).
   *
   * Mirrors {@link tripCircuitBreakerIfCurrent}: the expected-state guard makes
   * a concurrent conflicting mutation a no-op, and the marker is the watermark
   * that gives a manual resume a fresh success streak. Guarded by the daemon
   * lease fence like every scheduler transition.
   */
  expireLoopIfCurrent(
    id: string,
    expected: LoopSchedulingState,
    patch: Partial<Pick<Loop, "status" | "nextRunAt" | "retryScheduledFor">>,
    marker: { scheduledFor: string; reason: string },
    opts: DaemonLeaseFence = {},
  ): CircuitBreakerTransitionResult | undefined {
    const updated = (opts.now ?? new Date()).toISOString();
    const scrubbedReason = scrubbedOrNull(marker.reason) ?? "";
    if ("status" in patch && patch.status !== undefined) assertLoopStatus(patch.status);
    this.db.exec("BEGIN IMMEDIATE");
    let markerScheduledFor = marker.scheduledFor;
    try {
      const current = this.getLoop(id);
      if (
        !current ||
        current.archivedAt ||
        current.status !== expected.status ||
        current.nextRunAt !== expected.nextRunAt ||
        current.retryScheduledFor !== expected.retryScheduledFor
      ) {
        this.db.exec("COMMIT");
        return undefined;
      }
      const merged: Loop = { ...current, ...patch, updatedAt: updated };
      const res = this.db
        .query(
          `UPDATE loops SET status=$status, next_run_at=$nextRun, retry_scheduled_for=$retrySlot, updated_at=$updated
           WHERE id=$id
             AND archived_at IS NULL
             AND status=$expectedStatus
             AND next_run_at IS $expectedNextRun
             AND retry_scheduled_for IS $expectedRetrySlot
             AND ($daemonLeaseId IS NULL OR EXISTS (
               SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
             ))`,
        )
        .run({
          $id: id,
          $status: merged.status,
          $nextRun: merged.nextRunAt ?? null,
          $retrySlot: merged.retryScheduledFor ?? null,
          $updated: updated,
          $expectedStatus: expected.status,
          $expectedNextRun: expected.nextRunAt ?? null,
          $expectedRetrySlot: expected.retryScheduledFor ?? null,
          $daemonLeaseId: opts.daemonLeaseId ?? null,
          $now: updated,
        });
      if (res.changes !== 1) {
        this.db.exec("COMMIT");
        return undefined;
      }
      let markerAtMs = new Date(markerScheduledFor).getTime();
      for (let probe = 0; probe < 1_000 && this.getRunBySlot(id, new Date(markerAtMs).toISOString()); probe += 1) {
        markerAtMs += 1;
      }
      markerScheduledFor = new Date(markerAtMs).toISOString();
      const markerId = genId();
      this.db
        .query(
          `INSERT INTO loop_runs (id, loop_id, loop_name, scheduled_for, attempt, status, started_at, finished_at,
            claimed_by, lease_expires_at, pid, exit_code, duration_ms, stdout, stderr, error, created_at, updated_at)
           VALUES ($id, $loopId, $loopName, $scheduledFor, 1, 'skipped', NULL, $finished, NULL, NULL, NULL, NULL, NULL,
            NULL, NULL, $error, $created, $updated)`,
        )
        .run({
          $id: markerId,
          $loopId: current.id,
          $loopName: current.name,
          $scheduledFor: markerScheduledFor,
          $finished: updated,
          $error: scrubbedReason,
          $created: updated,
          $updated: updated,
        });
      if (patch.status && patch.status !== "active") {
        const status: WorkflowWorkItemStatus = patch.status === "paused" ? "deferred" : "cancelled";
        this.setWorkflowWorkItemsForLoop(id, status, `loop ${patch.status}`, updated);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      throw error;
    }
    const loop = this.getLoop(id);
    const createdMarker = this.getRunBySlot(id, markerScheduledFor);
    if (!loop || !createdMarker) throw new Error(`expiry transition missing committed rows: ${id}`);
    return { loop, marker: createdMarker };
  }

  expireLoops(now: Date = new Date(), opts: DaemonLeaseFence = {}): Loop[] {
    const rows = this.db
      .query<LoopRow, [string]>(
        "SELECT * FROM loops WHERE status = 'active' AND archived_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ?",
      )
      .all(now.toISOString());
    const expired: Loop[] = [];
    for (const row of rows) {
      const updated = this.updateLoop(row.id, { status: "expired", nextRunAt: undefined }, opts);
      if (updated.status === "expired") expired.push(updated);
    }
    return expired;
  }

  countLoops(status?: LoopStatus, opts: { archived?: boolean; includeArchived?: boolean } = {}): number {
    let row: { count: number } | null | undefined;
    if (status && opts.archived) {
      row = this.db
        .query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM loops WHERE status = ? AND archived_at IS NOT NULL")
        .get(status);
    } else if (status && opts.includeArchived) {
      row = this.db.query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM loops WHERE status = ?").get(status);
    } else if (status) {
      row = this.db
        .query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM loops WHERE status = ? AND archived_at IS NULL")
        .get(status);
    } else if (opts.archived) {
      row = this.db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM loops WHERE archived_at IS NOT NULL").get();
    } else if (opts.includeArchived) {
      row = this.db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM loops").get();
    } else {
      row = this.db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM loops WHERE archived_at IS NULL").get();
    }
    return row?.count ?? 0;
  }

  countRuns(opts: { loopId?: string; status?: RunStatus; labels?: string[] } = {}): number {
    // Mirrors listRuns' filters exactly (LOO3-00143 P1): the CLI's pagination
    // envelope must count the FILTERED population, never the global run table.
    const labels = normalizeLoopLabels(opts.labels);
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (opts.loopId) {
      where.push("loop_runs.loop_id = ?");
      params.push(opts.loopId);
    }
    if (opts.status) {
      where.push("loop_runs.status = ?");
      params.push(opts.status);
    }
    for (const label of labels) {
      where.push("EXISTS (SELECT 1 FROM json_each(label_loops.labels_json) WHERE value = ?)");
      params.push(label);
    }
    const join = labels.length ? " JOIN loops AS label_loops ON label_loops.id = loop_runs.loop_id" : "";
    const row = this.db
      .query<{ count: number }, Array<string | number>>(
        `SELECT COUNT(*) AS count FROM loop_runs${join}${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`,
      )
      .get(...params);
    return row?.count ?? 0;
  }

  exportMigrationRows(opts: StoreMigrationRowsOptions = {}): StoreMigrationRows {
    const includeRuns = opts.includeRuns ?? true;
    const workflows = this.db
      .query<WorkflowRow, []>("SELECT * FROM workflow_specs ORDER BY created_at ASC, id ASC")
      .all()
      .map(rowToWorkflow);
    const loops = this.db
      .query<LoopRow, []>("SELECT * FROM loops ORDER BY created_at ASC, id ASC")
      .all()
      .map(rowToLoop);
    const runs = includeRuns
      ? this.db
          .query<RunRow, []>("SELECT * FROM loop_runs ORDER BY created_at ASC, id ASC")
          .all()
          .map(rowToRun)
      : [];
    return { schemaVersion: SCHEMA_USER_VERSION, workflows, loops, runs, checks: this.migrationChecks() };
  }

  /**
   * Page through loop_runs for a streaming export. A full `exportMigrationRows`
   * loads every run's stdout/stderr into memory at once (hundreds of MB on a
   * busy host); a self-hosted backfill instead pulls stable ordered pages so
   * peak memory stays bounded. Order is deterministic (created_at, id) so
   * offset paging over an immutable snapshot never skips or repeats a row.
   */
  exportMigrationRunPage(opts: { limit: number; offset: number }): LoopRun[] {
    return this.db
      .query<RunRow, [number, number]>("SELECT * FROM loop_runs ORDER BY created_at ASC, id ASC LIMIT ? OFFSET ?")
      .all(opts.limit, opts.offset)
      .map(rowToRun);
  }

  private countTable(table: string): number {
    const row = this.db.query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM ${table}`).get();
    return row?.count ?? 0;
  }

  private migrationChecks(): StoreMigrationChecks {
    const now = nowIso();
    return {
      unsupportedCounts: {
        workflowInvocations: this.countTable("workflow_invocations"),
        workflowWorkItems: this.countTable("workflow_work_items"),
        workflowRuns: this.countTable("workflow_runs"),
        workflowStepRuns: this.countTable("workflow_step_runs"),
        workflowEvents: this.countTable("workflow_events"),
        goals: this.countTable("goals"),
        goalPlanNodes: this.countTable("goal_plan_nodes"),
        goalRuns: this.countTable("goal_runs"),
      },
      volatileCounts: {
        daemonLeases: this.countTable("daemon_lease"),
        activeDaemonLeases: this.db
          .query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM daemon_lease WHERE expires_at > ?")
          .get(now)?.count ?? 0,
        runningLoopRuns: this.db
          .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM loop_runs WHERE status = 'running'")
          .get()?.count ?? 0,
        runningWorkflowRuns: this.db
          .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM workflow_runs WHERE status = 'running'")
          .get()?.count ?? 0,
        runningWorkflowStepRuns: this.db
          .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM workflow_step_runs WHERE status = 'running'")
          .get()?.count ?? 0,
        leasedWorkflowWorkItems: this.db
          .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM workflow_work_items WHERE lease_expires_at IS NOT NULL OR status IN ('admitted', 'running')")
          .get()?.count ?? 0,
      },
    };
  }

  upsertMigrationWorkflow(workflow: WorkflowSpec, opts: StoreMigrationUpsertOptions = {}): WorkflowSpec {
    const existing = this.getWorkflow(workflow.id);
    if (existing && !opts.replace) return existing;
    this.db
      .query(
        `INSERT INTO workflow_specs (id, name, description, version, status, goal_json, steps_json, created_at, updated_at)
         VALUES ($id, $name, $description, $version, $status, $goal, $steps, $created, $updated)
         ON CONFLICT(id) DO UPDATE SET
           name=$name,
           description=$description,
           version=$version,
           status=$status,
           goal_json=$goal,
           steps_json=$steps,
           created_at=$created,
           updated_at=$updated`,
      )
      .run({
        $id: workflow.id,
        $name: workflow.name,
        $description: workflow.description ?? null,
        $version: workflow.version,
        $status: workflow.status,
        $goal: workflow.goal ? JSON.stringify(workflow.goal) : null,
        $steps: JSON.stringify(workflow.steps),
        $created: workflow.createdAt,
        $updated: workflow.updatedAt,
      });
    const imported = this.getWorkflow(workflow.id);
    if (!imported) throw new Error(`workflow not found after migration import: ${workflow.id}`);
    return imported;
  }

  upsertMigrationLoop(loop: Loop, opts: StoreMigrationUpsertOptions = {}): Loop {
    const existing = this.getLoop(loop.id);
    if (existing && !opts.replace) return existing;
    this.assertNoNestedWorkflowGoal(loop.target, loop.goal);
    this.db
      .query(
        `INSERT INTO loops (id, name, description, labels_json, status, archived_at, archived_from_status, schedule_json, target_json,
          goal_json, machine_json, next_run_at, retry_scheduled_for, catch_up, catch_up_limit, overlap, max_attempts,
          retry_delay_ms, lease_ms, expires_at, expires_after_runs, created_at, updated_at)
         VALUES ($id, $name, $description, $labels, $status, $archivedAt, $archivedFromStatus, $schedule, $target,
          $goal, $machine, $nextRun, $retrySlot, $catchUp, $catchUpLimit, $overlap, $maxAttempts,
          $retryDelay, $leaseMs, $expiresAt, $expiresAfterRuns, $created, $updated)
         ON CONFLICT(id) DO UPDATE SET
           name=$name,
           description=$description,
           labels_json=$labels,
           status=$status,
           archived_at=$archivedAt,
           archived_from_status=$archivedFromStatus,
           schedule_json=$schedule,
           target_json=$target,
           goal_json=$goal,
           machine_json=$machine,
           next_run_at=$nextRun,
           retry_scheduled_for=$retrySlot,
           catch_up=$catchUp,
           catch_up_limit=$catchUpLimit,
           overlap=$overlap,
           max_attempts=$maxAttempts,
           retry_delay_ms=$retryDelay,
           lease_ms=$leaseMs,
           expires_at=$expiresAt,
           expires_after_runs=$expiresAfterRuns,
           created_at=$created,
           updated_at=$updated`,
      )
      .run({
        $id: loop.id,
        $name: loop.name,
        $description: loop.description ?? null,
        $labels: JSON.stringify(normalizeLoopLabels(loop.labels)),
        $status: loop.status,
        $archivedAt: loop.archivedAt ?? null,
        $archivedFromStatus: loop.archivedFromStatus ?? null,
        $schedule: JSON.stringify(loop.schedule),
        $target: JSON.stringify(loop.target),
        $goal: loop.goal ? JSON.stringify(loop.goal) : null,
        $machine: loop.machine ? JSON.stringify(loop.machine) : null,
        $nextRun: loop.nextRunAt ?? null,
        $retrySlot: loop.retryScheduledFor ?? null,
        $catchUp: loop.catchUp,
        $catchUpLimit: loop.catchUpLimit,
        $overlap: loop.overlap,
        $maxAttempts: loop.maxAttempts,
        $retryDelay: loop.retryDelayMs,
        $leaseMs: loop.leaseMs,
        $expiresAt: loop.expiresAt ?? null,
        $expiresAfterRuns: loop.expiresAfterRuns ?? null,
        $created: loop.createdAt,
        $updated: loop.updatedAt,
      });
    const imported = this.getLoop(loop.id);
    if (!imported) throw new Error(`loop not found after migration import: ${loop.id}`);
    return imported;
  }

  upsertMigrationRun(run: LoopRun, opts: StoreMigrationUpsertOptions = {}): LoopRun {
    if (run.status === "running") throw new ValidationError(`cannot import running run ${run.id}`);
    const existing = this.getRun(run.id);
    if (existing && !opts.replace) return existing;
    this.db
      .query(
        `INSERT INTO loop_runs (id, loop_id, loop_name, scheduled_for, attempt, status, started_at, finished_at,
          claimed_by, claim_token, lease_expires_at, pid, pgid, process_started_at, exit_code, duration_ms,
          stdout, stderr, error, goal_run_id, created_at, updated_at)
         VALUES ($id, $loopId, $loopName, $scheduledFor, $attempt, $status, $startedAt, $finishedAt,
          $claimedBy, NULL, $leaseExpiresAt, $pid, $pgid, $processStartedAt, $exitCode, $durationMs,
          $stdout, $stderr, $error, $goalRunId, $created, $updated)
         ON CONFLICT(id) DO UPDATE SET
           loop_id=$loopId,
           loop_name=$loopName,
           scheduled_for=$scheduledFor,
           attempt=$attempt,
           status=$status,
           started_at=$startedAt,
           finished_at=$finishedAt,
           claimed_by=$claimedBy,
           claim_token=NULL,
           lease_expires_at=$leaseExpiresAt,
           pid=$pid,
           pgid=$pgid,
           process_started_at=$processStartedAt,
           exit_code=$exitCode,
           duration_ms=$durationMs,
           stdout=$stdout,
           stderr=$stderr,
           error=$error,
           goal_run_id=$goalRunId,
           created_at=$created,
           updated_at=$updated`,
      )
      .run({
        $id: run.id,
        $loopId: run.loopId,
        $loopName: run.loopName,
        $scheduledFor: run.scheduledFor,
        $attempt: run.attempt,
        $status: run.status,
        $startedAt: run.startedAt ?? null,
        $finishedAt: run.finishedAt ?? null,
        $claimedBy: run.claimedBy ?? null,
        $leaseExpiresAt: run.leaseExpiresAt ?? null,
        $pid: run.pid ?? null,
        $pgid: run.pgid ?? null,
        $processStartedAt: run.processStartedAt ?? null,
        $exitCode: run.exitCode ?? null,
        $durationMs: run.durationMs ?? null,
        $stdout: persistedRunOutput(run.stdout),
        $stderr: persistedRunOutput(run.stderr),
        $error: scrubbedOrNull(run.error),
        $goalRunId: run.goalRunId ?? null,
        $created: run.createdAt,
        $updated: run.updatedAt,
      });
    const imported = this.getRun(run.id);
    if (!imported) throw new Error(`run not found after migration import: ${run.id}`);
    return imported;
  }

  /**
   * Delete old terminal run history: loop runs plus their attached workflow
   * runs (step runs and events cascade), goal run events, and per-run manifest
   * directories. At least one of maxAgeDays / keepPerLoop must be provided;
   * when both are given a run is only deleted when it is older than the cutoff
   * AND beyond the per-loop retention floor. Running runs are never touched.
   */
  pruneHistory(opts: PruneHistoryOptions): PruneHistorySummary {
    const { maxAgeDays, keepPerLoop } = opts;
    if (maxAgeDays === undefined && keepPerLoop === undefined) {
      throw new ValidationError("pruneHistory requires maxAgeDays and/or keepPerLoop");
    }
    if (maxAgeDays !== undefined && (!Number.isFinite(maxAgeDays) || maxAgeDays < 0)) {
      throw new ValidationError(`pruneHistory maxAgeDays must be a non-negative number: ${maxAgeDays}`);
    }
    if (keepPerLoop !== undefined && (!Number.isInteger(keepPerLoop) || keepPerLoop < 0)) {
      throw new ValidationError(`pruneHistory keepPerLoop must be a non-negative integer: ${keepPerLoop}`);
    }
    const now = opts.now ?? new Date();
    const dryRun = opts.dryRun ?? false;
    const cutoff = maxAgeDays === undefined ? undefined : new Date(now.getTime() - maxAgeDays * 86_400_000).toISOString();
    const terminal = TERMINAL_RUN_STATUSES.map((status) => `'${status}'`).join(",");
    const candidateIds = this.db
      .query<{ id: string }, { $cutoff: string | null; $keep: number | null }>(
        `WITH ranked AS (
           SELECT id, status, created_at,
             ROW_NUMBER() OVER (PARTITION BY loop_id ORDER BY created_at DESC, id DESC) AS recency
           FROM loop_runs
         )
         SELECT id FROM ranked
         WHERE status IN (${terminal})
           AND ($cutoff IS NULL OR created_at < $cutoff)
           AND ($keep IS NULL OR recency > $keep)`,
      )
      .all({ $cutoff: cutoff ?? null, $keep: keepPerLoop ?? null })
      .map((row) => row.id);

    const summary: PruneHistorySummary = {
      dryRun,
      cutoff,
      keepPerLoop,
      loopRuns: dryRun ? candidateIds.length : 0,
      workflowRuns: 0,
      goalRuns: 0,
    };
    const manifestPaths: string[] = [];
    for (let offset = 0; offset < candidateIds.length; offset += PRUNE_BATCH_SIZE) {
      const batch = candidateIds.slice(offset, offset + PRUNE_BATCH_SIZE);
      const batchPlaceholders = batch.map(() => "?").join(",");
      if (dryRun) {
        const workflowRunIds = this.db
          .query<{ id: string }, string[]>(`SELECT id FROM workflow_runs WHERE loop_run_id IN (${batchPlaceholders})`)
          .all(...batch)
          .map((row) => row.id);
        const workflowPlaceholders = workflowRunIds.map(() => "?").join(",") || "''";
        summary.workflowRuns += workflowRunIds.length;
        summary.goalRuns += this.db
          .query<{ count: number }, string[]>(
            `SELECT COUNT(*) AS count FROM goal_runs
             WHERE loop_run_id IN (${batchPlaceholders}) OR workflow_run_id IN (${workflowPlaceholders})`,
          )
          .get(...batch, ...workflowRunIds)?.count ?? 0;
        continue;
      }
      this.transact(() => {
        // Re-verify terminal status inside the transaction: a candidate may
        // have been reclaimed back to 'running' (retry) between selection and
        // this batch, and deleting it would orphan a live child process.
        const confirmed = this.db
          .query<{ id: string }, string[]>(
            `SELECT id FROM loop_runs WHERE id IN (${batchPlaceholders}) AND status IN (${terminal})`,
          )
          .all(...batch)
          .map((row) => row.id);
        if (confirmed.length === 0) return;
        const runPlaceholders = confirmed.map(() => "?").join(",");
        const workflowRuns = this.db
          .query<{ id: string; manifest_path: string | null }, string[]>(
            `SELECT id, manifest_path FROM workflow_runs WHERE loop_run_id IN (${runPlaceholders})`,
          )
          .all(...confirmed);
        const workflowRunIds = workflowRuns.map((row) => row.id);
        const workflowPlaceholders = workflowRunIds.map(() => "?").join(",") || "''";
        summary.loopRuns += confirmed.length;
        summary.workflowRuns += workflowRunIds.length;
        summary.goalRuns += this.db
          .query(
            `DELETE FROM goal_runs WHERE loop_run_id IN (${runPlaceholders}) OR workflow_run_id IN (${workflowPlaceholders})`,
          )
          .run(...confirmed, ...workflowRunIds).changes;
        if (workflowRunIds.length > 0) {
          this.db.query(`DELETE FROM workflow_runs WHERE id IN (${workflowPlaceholders})`).run(...workflowRunIds);
        }
        this.db.query(`DELETE FROM loop_runs WHERE id IN (${runPlaceholders}) AND status IN (${terminal})`).run(...confirmed);
        for (const row of workflowRuns) {
          if (row.manifest_path) manifestPaths.push(row.manifest_path);
        }
      });
    }
    // Filesystem cleanup happens after the database deletes have committed so
    // a rollback never leaves rows pointing at missing manifests.
    for (const manifestPath of manifestPaths) {
      const runDir = dirname(manifestPath);
      try {
        // Each manifest lives in a per-run directory named after the workflow
        // run id; remove the whole directory only when the layout matches.
        if (/^[0-9a-f]{12,64}$/.test(basename(runDir))) {
          rmSync(runDir, { recursive: true, force: true });
        } else {
          rmSync(manifestPath, { force: true });
        }
      } catch {
        /* manifest cleanup is best-effort */
      }
    }
    return summary;
  }

  acquireDaemonLease(input: {
    id: string;
    pid: number;
    hostname: string;
    ttlMs: number;
    now?: Date;
  }): DaemonLease | undefined {
    const now = input.now ?? new Date();
    const expiresAt = new Date(now.getTime() + input.ttlMs).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db.query<LeaseRow, []>("SELECT * FROM daemon_lease LIMIT 1").get();
      if (existing && existing.expires_at > now.toISOString() && existing.id !== input.id) {
        this.db.exec("COMMIT");
        return undefined;
      }
      this.db.query("DELETE FROM daemon_lease").run();
      this.db
        .query(
          `INSERT INTO daemon_lease (id, pid, hostname, heartbeat_at, expires_at, created_at, updated_at)
           VALUES ($id, $pid, $hostname, $heartbeat, $expires, $created, $updated)`,
        )
        .run({
          $id: input.id,
          $pid: input.pid,
          $hostname: input.hostname,
          $heartbeat: now.toISOString(),
          $expires: expiresAt,
          $created: now.toISOString(),
          $updated: now.toISOString(),
        });
      this.db.exec("COMMIT");
      return this.getDaemonLease();
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      throw error;
    }
  }

  heartbeatDaemonLease(id: string, ttlMs: number, now: Date = new Date()): DaemonLease | undefined {
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    const res = this.db
      .query(
        `UPDATE daemon_lease SET heartbeat_at=$heartbeat, expires_at=$expires, updated_at=$updated WHERE id=$id AND expires_at > $now`,
      )
      .run({ $id: id, $heartbeat: now.toISOString(), $expires: expiresAt, $updated: now.toISOString(), $now: now.toISOString() });
    if (res.changes !== 1) return undefined;
    return this.getDaemonLease();
  }

  releaseDaemonLease(id: string): void {
    this.db.query("DELETE FROM daemon_lease WHERE id = ?").run(id);
  }

  getDaemonLease(): DaemonLease | undefined {
    const row = this.db.query<LeaseRow, []>("SELECT * FROM daemon_lease LIMIT 1").get();
    return row ? rowToLease(row) : undefined;
  }

  writeTransaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const result = fn();
      this.db.exec("COMMIT;");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK;");
      } catch {
        // If SQLite already unwound the transaction, preserve the original error.
      }
      throw error;
    }
  }

  close(): void {
    this.db.close();
    // A `:memory:` store still mkdtempSync's a scratch root for manifests; remove
    // it on close so repeated in-memory instances (tests) don't leak temp dirs.
    if (this.memoryRootDir) {
      try {
        rmSync(this.memoryRootDir, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
      this.memoryRootDir = undefined;
    }
  }
}
