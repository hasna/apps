import type { GoalSpec } from "./lib/goal/types.js";
export type {
  Goal,
  GoalAutoExecute,
  GoalExecutorResult,
  GoalPlan,
  GoalPlanNode,
  GoalPlanNodeStatus,
  GoalPlanStatus,
  GoalRollup,
  GoalRun,
  GoalSpec,
  GoalStatus,
} from "./lib/goal/types.js";

export type LoopStatus = "active" | "paused" | "stopped" | "expired";

export type RunStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "abandoned"
  | "skipped";

export interface RecoveredLeaseRunSnapshotEntry {
  updatedAt: string;
  scheduledFor: string;
  id: string;
  attempt: number;
}

export type CatchUpPolicy = "none" | "latest" | "all";

export type OverlapPolicy = "skip" | "allow";

export type IntervalAnchor = "fixed_rate" | "fixed_delay";

export interface AccountRef {
  profile: string;
  tool?: string;
}

export type LoopMachineRoute = "local" | "lan" | "tailscale" | "ssh" | "unknown";

export type LoopMachineConfidence = "exact" | "high" | "medium" | "low" | "none";

export interface LoopMachineRef {
  id: string;
  requestedId?: string;
  route?: LoopMachineRoute;
  local?: boolean;
  confidence?: LoopMachineConfidence;
  workspacePath?: string;
  resolvedAt?: string;
  packageVersion?: string;
  warnings?: string[];
}

export interface OnceSchedule {
  type: "once";
  at: string;
}

export interface IntervalSchedule {
  type: "interval";
  everyMs: number;
  anchor?: IntervalAnchor;
}

export interface CronSchedule {
  type: "cron";
  expression: string;
}

export interface DynamicSchedule {
  type: "dynamic";
  minIntervalMs?: number;
}

export type ScheduleSpec = OnceSchedule | IntervalSchedule | CronSchedule | DynamicSchedule;

export interface RuntimePreflightPolicy {
  beforeRun?: boolean;
}

export interface OpenAutomationsRuntimeBinding {
  integration: "open-automations";
  role: "runtime";
  handoff: "claim-queue";
  queueOwner: "open-automations";
  runtimeOwner: "open-loops";
  statusCommand: "automations status";
  claimCommand: "automations queue claim";
  completeCommand: "automations queue complete";
  failCommand: "automations queue fail";
  eventHandoff: {
    envelopeCommand: "automations webhooks event";
    handlerCommand: "loops routes create generic";
    pipeExample: string;
    boundary: string;
  };
  requiredEnvironment: string[];
  guarantees: string[];
  nonGoals: string[];
}

export interface CommandTarget {
  type: "command";
  command: string;
  args?: string[];
  cwd?: string;
  shell?: boolean;
  env?: Record<string, string>;
  timeoutMs?: TimeoutMs;
  idleTimeoutMs?: number;
  account?: AccountRef;
  preflight?: RuntimePreflightPolicy;
}

export type TimeoutMs = number | null;

export type AgentProvider = "claude" | "cursor" | "codewith" | "aicopilot" | "opencode" | "codex";

export type AgentConfigIsolation = "safe" | "none";

export type AgentPermissionMode = "default" | "plan" | "auto" | "bypass";

export type AgentSandbox = "read-only" | "workspace-write" | "danger-full-access" | "enabled" | "disabled";

export type AgentAllowlistEnforcement = "metadata_only";

export interface AgentAllowlistSpec {
  /** Advisory provider metadata. Restrictions require this non-empty audit reason. */
  tools?: string[];
  commands?: string[];
  enforcement?: AgentAllowlistEnforcement;
  safetyReason?: string;
}

export type AgentWorktreeMode = "auto" | "required" | "off" | "main";

export interface AgentWorktreeSpec {
  mode: AgentWorktreeMode;
  enabled: boolean;
  originalCwd: string;
  cwd: string;
  repoRoot?: string;
  root?: string;
  path?: string;
  branch?: string;
  reason?: string;
}

export interface AgentRoutingSpec {
  projectPath?: string;
  projectGroup?: string;
  taskId?: string;
  eventId?: string;
  eventType?: string;
  eventSource?: string;
  /** Lifecycle role of this agent step (triage/planner/worker/verifier). Used
   *  for per-account attribution and least-loaded auth-profile pool selection. */
  role?: "triage" | "planner" | "worker" | "verifier";
}

/** Server-derived audit contract for an agent step inside a workflow run. */
export interface AgentSessionContract {
  version: 1;
  provider: AgentProvider;
  model?: string;
  cwd?: string;
  permissionMode: AgentPermissionMode;
  sandbox: AgentSandbox | "provider-default";
  manualBreakGlass: boolean;
  routing?: AgentRoutingSpec;
  timeoutMs: TimeoutMs;
  restrictions: {
    tools?: string[];
    commands?: string[];
    enforcement: AgentAllowlistEnforcement;
    providerEnforced: false;
  };
  safetyReason?: string;
}

export interface AgentPromptSource {
  type: "file";
  path: string;
}

export interface AgentTargetBase {
  type: "agent";
  provider: AgentProvider;
  cwd?: string;
  model?: string;
  variant?: string;
  agent?: string;
  authProfile?: string;
  /** Environment variables merged into the run's process environment, same as CommandTarget.env. */
  env?: Record<string, string>;
  /**
   * Provider CLI passthrough arguments. Fail-closed: omitted or empty is valid,
   * while every non-empty or malformed entry is rejected until that exact
   * provider option is explicitly reviewed and allowlisted by the adapter.
   */
  extraArgs?: string[];
  addDirs?: string[];
  timeoutMs?: TimeoutMs;
  idleTimeoutMs?: number;
  configIsolation?: AgentConfigIsolation;
  permissionMode?: AgentPermissionMode;
  sandbox?: AgentSandbox;
  /** Explicit operator acknowledgement required with a non-empty safetyReason for relaxed sandbox or provider bypass modes. */
  manualBreakGlass?: boolean;
  /**
   * Declare a target as a scheduled/durable automated lane (for example a loop
   * that staffs a deploy chain). An automated lane may use relaxed sandbox or
   * provider bypass modes with a documented safetyReason without being forced
   * to declare manualBreakGlass, which is reserved for human-initiated
   * break-glass emergencies.
   */
  automated?: boolean;
  allowlist?: AgentAllowlistSpec;
  worktree?: AgentWorktreeSpec;
  routing?: AgentRoutingSpec;
  account?: AccountRef;
  preflight?: RuntimePreflightPolicy;
}

export interface AgentTarget extends AgentTargetBase {
  prompt: string;
  promptSource?: AgentPromptSource;
}

export interface PromptFileAgentTarget extends AgentTargetBase {
  promptFile: string;
}

export interface WorkflowTarget {
  type: "workflow";
  workflowId: string;
  input?: Record<string, string>;
  timeoutMs?: TimeoutMs;
  preflight?: RuntimePreflightPolicy;
}

export type ExecutableTarget = CommandTarget | AgentTarget;
export type ExecutableTargetInput = CommandTarget | AgentTarget | PromptFileAgentTarget;

export type LoopTarget = ExecutableTarget | WorkflowTarget;
export type LoopTargetInput = ExecutableTargetInput | WorkflowTarget;

export type WorkflowStatus = "active" | "archived";

export type WorkflowRunStatus = "running" | "succeeded" | "failed" | "timed_out" | "cancelled";

export type WorkflowStepRunStatus = "pending" | "running" | "succeeded" | "failed" | "timed_out" | "skipped" | "cancelled";

export type WorkflowInvocationSourceKind = "task" | "event" | "schedule" | "manual" | "pr" | "review" | "knowledge";

export type WorkflowInvocationSubjectKind = "repo" | "pr" | "task" | "doc" | "run" | "metric";

export type WorkflowInvocationIntent = "route" | "mutate" | "review" | "evaluate" | "report";

export interface WorkflowInvocationRef {
  kind: string;
  id?: string;
  path?: string;
  url?: string;
  dedupeKey?: string;
  raw?: Record<string, unknown>;
}

export interface WorkflowInvocationScope {
  projectPath?: string;
  todosProjectPath?: string;
  projectGroup?: string;
  worktreePolicy?: AgentWorktreeMode;
  permissions?: string;
  accountPolicy?: string;
  concurrencyGroup?: string;
  [key: string]: unknown;
}

export interface WorkflowInvocationOutputPolicy {
  report?: "always" | "on_change" | "on_failure";
  createTask?: "never" | "on_actionable" | "on_failure" | "always";
  [key: string]: unknown;
}

export interface WorkflowInvocation {
  id: string;
  workflowId?: string;
  templateId?: string;
  sourceRef: WorkflowInvocationRef;
  subjectRef: WorkflowInvocationRef;
  intent: WorkflowInvocationIntent;
  scope?: WorkflowInvocationScope;
  outputPolicy?: WorkflowInvocationOutputPolicy;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkflowInvocationInput {
  id?: string;
  workflowId?: string;
  templateId?: string;
  sourceRef: WorkflowInvocationRef;
  subjectRef: WorkflowInvocationRef;
  intent: WorkflowInvocationIntent;
  scope?: WorkflowInvocationScope;
  outputPolicy?: WorkflowInvocationOutputPolicy;
}

export type WorkflowWorkItemStatus =
  | "queued"
  | "deferred"
  | "admitted"
  | "running"
  | "succeeded"
  | "failed"
  | "dead_letter"
  | "cancelled";

export interface WorkflowWorkItem {
  id: string;
  routeKey: string;
  idempotencyKey: string;
  invocationId: string;
  sourceType: string;
  sourceRef: string;
  subjectRef: string;
  projectKey?: string;
  projectGroup?: string;
  /** Machine that reserved/admitted this route work item, when known. */
  machineId?: string;
  /**
   * The drain/route identity (loop name) that admitted this item. Used to scope
   * the `--max-active` global admission count to a single route instead of the
   * whole store. Undefined for items created before route-scope support.
   */
  routeScope?: string;
  priority: number;
  status: WorkflowWorkItemStatus;
  attempts: number;
  /**
   * Consecutive non-productive "gate death" finishes (runs that failed at
   * worktree prep or a fast triage/planner gate before any real work). Gate
   * deaths refund their redispatch attempt, so this second counter bounds a
   * deterministic infrastructure fault: at the ceiling the item is
   * dead-lettered instead of retrying forever. Reset by a run that reaches
   * the worker (success, productive failure, or tempfail) and by an
   * operator requeue with attempts reset.
   */
  gateDeaths: number;
  nextAttemptAt?: string;
  leaseExpiresAt?: string;
  workflowId?: string;
  loopId?: string;
  workflowRunId?: string;
  lastReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertWorkflowWorkItemInput {
  id?: string;
  routeKey: string;
  idempotencyKey: string;
  invocationId: string;
  sourceType: string;
  sourceRef: string;
  subjectRef: string;
  projectKey?: string;
  projectGroup?: string;
  machineId?: string;
  routeScope?: string;
  priority?: number;
  status?: Extract<WorkflowWorkItemStatus, "queued" | "deferred">;
  nextAttemptAt?: string;
  lastReason?: string;
}

export interface WorkflowStep {
  id: string;
  name?: string;
  description?: string;
  target: ExecutableTarget;
  goal?: GoalSpec;
  dependsOn?: string[];
  continueOnFailure?: boolean;
  timeoutMs?: TimeoutMs;
  account?: AccountRef;
}

export interface WorkflowStepInput extends Omit<WorkflowStep, "target"> {
  target: ExecutableTargetInput;
}

export interface WorkflowSpec {
  id: string;
  name: string;
  description?: string;
  version: number;
  status: WorkflowStatus;
  goal?: GoalSpec;
  steps: WorkflowStep[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkflowInput {
  name: string;
  description?: string;
  goal?: GoalSpec;
  steps: WorkflowStepInput[];
  version?: number;
}

export type LoopTemplateKind = "workflow" | "loop";
export type LoopTemplateSource = "builtin" | "custom";
export type LoopTemplateVariableType = "string" | "number" | "boolean" | "json" | "string[]";

export interface LoopTemplateVariable {
  name: string;
  description?: string;
  required?: boolean;
  default?: string;
  type?: LoopTemplateVariableType;
}

export interface LoopTemplateSummary {
  id: string;
  name: string;
  description: string;
  kind: LoopTemplateKind;
  variables: LoopTemplateVariable[];
  source?: LoopTemplateSource;
  sourcePath?: string;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowName: string;
  loopId?: string;
  loopRunId?: string;
  invocationId?: string;
  workItemId?: string;
  scheduledFor?: string;
  idempotencyKey?: string;
  manifestPath?: string;
  goalRunId?: string;
  status: WorkflowRunStatus;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowStepRun {
  id: string;
  workflowRunId: string;
  stepId: string;
  sequence: number;
  status: WorkflowStepRunStatus;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  pid?: number;
  /**
   * Start time of {@link pid}, recorded at spawn (migration 0014). Pairs with
   * the pid to survive pid recycling; absent on rows written before 0014.
   */
  processStartedAt?: string;
  durationMs?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
  accountProfile?: string;
  accountTool?: string;
  goalRunId?: string;
  createdAt: string;
  updatedAt: string;
}

export type WorkflowLifecycleEventType =
  | "created"
  | "workflow_archived"
  | "todos_workflow_pointers_synced"
  | "todos_workflow_pointers_sync_failed"
  | "step_started"
  | "step_progress"
  | "recovered"
  | "step_pending"
  | "step_running"
  | "step_succeeded"
  | "step_failed"
  | "step_timed_out"
  | "step_skipped"
  | "step_cancelled"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled";

export interface WorkflowEventBase {
  id: string;
  workflowRunId: string;
  sequence: number;
  stepId?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

/** Raw persisted event shape used inside storage adapters before public validation. */
export interface StoredWorkflowEvent extends WorkflowEventBase {
  eventType: string;
}

export interface GenericWorkflowEvent extends WorkflowEventBase {
  eventType: WorkflowLifecycleEventType;
}

export interface AgentSessionContractWorkflowEvent extends Omit<WorkflowEventBase, "stepId" | "payload"> {
  eventType: "agent_session_contract";
  stepId: string;
  payload: AgentSessionContract;
}

/**
 * Backwards-compatible public shape for historical or mixed-version custom
 * events. `eventKind` makes the generic branch unambiguous without weakening
 * the schemas of server-owned lifecycle and agent-session-contract events.
 */
export interface CustomWorkflowEvent extends WorkflowEventBase {
  eventKind: "custom";
  eventType: string;
}

export type WorkflowEvent = AgentSessionContractWorkflowEvent | GenericWorkflowEvent;
export type PublicWorkflowEvent = WorkflowEvent | CustomWorkflowEvent;

export interface Loop {
  id: string;
  name: string;
  description?: string;
  /** Persisted loop labels. Legacy in-memory fixtures may omit this; stores normalize it to an empty array. */
  labels?: string[];
  status: LoopStatus;
  archivedAt?: string;
  archivedFromStatus?: LoopStatus;
  schedule: ScheduleSpec;
  target: LoopTarget;
  goal?: GoalSpec;
  machine?: LoopMachineRef;
  nextRunAt?: string;
  retryScheduledFor?: string;
  catchUp: CatchUpPolicy;
  catchUpLimit: number;
  overlap: OverlapPolicy;
  maxAttempts: number;
  retryDelayMs: number;
  leaseMs: number;
  expiresAt?: string;
  /** Expire the loop after this many consecutive successful runs. Independent of expiresAt. */
  expiresAfterRuns?: number;
  /**
   * The bundle namespace key: the S3 prefix and the CLI argument that name this
   * loop's portable, versioned representation. NULL until the loop is first
   * bundled. Distinct from `name` because loop names are NOT unique (the
   * `loops hygiene duplicates` report exists because duplicates do), while an
   * object key and a CLI argument must resolve to exactly one loop.
   */
  bundleName?: string;
  /** The bundle version a runner must materialise. Absent means "follow latest". */
  bundlePinnedVersion?: number;
  latestRunId?: string;
  latestRunStatus?: RunStatus;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LoopRun {
  id: string;
  loopId: string;
  loopName: string;
  scheduledFor: string;
  attempt: number;
  status: RunStatus;
  startedAt?: string;
  finishedAt?: string;
  claimedBy?: string;
  leaseExpiresAt?: string;
  pid?: number;
  pgid?: number;
  processStartedAt?: string;
  exitCode?: number;
  durationMs?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
  goalRunId?: string;
  createdAt: string;
  updatedAt: string;
}

export type RunReceiptMachine = string | Record<string, unknown>;

export interface RunReceiptSummary {
  text?: string;
  stdout_bytes: number;
  stderr_bytes: number;
  stdout_excerpt?: string;
  stderr_excerpt?: string;
  error?: string;
  duration_ms?: number;
}

/**
 * Which immutable bundle version produced a run.
 *
 * Present only for bundled loops. It is the receipt's answer to "what code ran
 * here?" - the digest names the exact file set, so a receipt can be tied back
 * to a `loop_revisions` row (and to the object in the artifact bucket) long
 * after the local tree has moved on.
 */
export interface RunReceiptBundle {
  name: string;
  version: number;
  digest: string;
}

export interface RunReceipt {
  loop_id: string;
  run_id: string;
  machine: RunReceiptMachine;
  repo: string;
  task_ids: string[];
  knowledge_ids: string[];
  digest_id: string;
  started_at: string | null;
  finished_at: string | null;
  status: string;
  exit_code: number | null;
  summary: RunReceiptSummary;
  evidence_paths: string[];
  bundle: RunReceiptBundle | null;
  created_at: string;
  updated_at: string;
}

export interface WriteRunReceiptInput {
  loop_id?: string;
  run_id: string;
  bundle?: RunReceiptBundle | null;
  machine?: RunReceiptMachine;
  repo?: string;
  task_ids?: string[];
  knowledge_ids?: string[];
  digest_id?: string;
  started_at?: string | null;
  finished_at?: string | null;
  status?: string;
  exit_code?: number | null;
  summary?: string | Partial<RunReceiptSummary> | null;
  evidence_paths?: string[];
  stdout?: string;
  stderr?: string;
  error?: string;
  duration_ms?: number;
}

export interface CreateLoopInput {
  name: string;
  description?: string;
  labels?: string[];
  schedule: ScheduleSpec;
  target: LoopTargetInput;
  goal?: GoalSpec;
  machine?: LoopMachineRef;
  catchUp?: CatchUpPolicy;
  catchUpLimit?: number;
  overlap?: OverlapPolicy;
  maxAttempts?: number;
  retryDelayMs?: number;
  leaseMs?: number;
  expiresAt?: string;
  /** Expire the loop after this many consecutive successful runs. Independent of expiresAt. */
  expiresAfterRuns?: number;
}

export interface ExecutorResult {
  status: "succeeded" | "failed" | "timed_out";
  exitCode?: number;
  stdout: string;
  stderr: string;
  error?: string;
  pid?: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /**
   * The bundle version this run executed, for a bundled loop.
   *
   * Carried out of the executor rather than re-derived by whoever writes the
   * receipt: by then the tree may already have been re-pulled, and a receipt
   * that names the version present at WRITE time instead of at RUN time proves
   * nothing.
   */
  bundle?: RunReceiptBundle;
}

export interface PersistGuardOptions {
  beforePersist?: () => void;
  daemonLeaseId?: string;
}

/** Where a revision's archive bytes were placed. `db` is reserved for the shared kit's column shape. */
export type LoopRevisionStorageKind = "db" | "s3";

/**
 * One row of the append-only loop revision ledger.
 *
 * Never updated and never deleted except by the loop's own cascade. A rollback
 * appends a NEW revision carrying the older revision's digest and storage key,
 * with `rolledBackFrom` set — the history of what a loop was is not editable by
 * the act of going back to it.
 */
export interface LoopRevision {
  loopId: string;
  version: number;
  bundleName: string;
  bundleDigest: string;
  archiveSha256: string;
  archiveBytes: number;
  storageKind: LoopRevisionStorageKind;
  storageKey?: string;
  manifest: Record<string, unknown>;
  /** The loop definition as of this version — `loop.json`, verbatim. */
  loopJson: Record<string, unknown>;
  carriesPrompt: boolean;
  /** Principal id of the key that pushed it. */
  author: string;
  sourceStation?: string;
  sourceAgent?: string;
  reason?: string;
  /** Set when this revision was produced by a rollback to that earlier version. */
  rolledBackFrom?: number;
  createdAt: string;
}

export interface CreateLoopRevisionInput {
  loopId: string;
  bundleName: string;
  bundleDigest: string;
  archiveSha256: string;
  archiveBytes: number;
  storageKind: LoopRevisionStorageKind;
  storageKey?: string;
  /**
   * Builds the storage key from the version the store actually allocated.
   *
   * The key contains the version, and the version is not known until the insert
   * transaction has taken it — so a caller that guessed the version beforehand
   * would record the wrong key the moment two pushes raced. Not persisted; when
   * present it wins over `storageKey`.
   */
  storageKeyFor?: (version: number) => string;
  manifest: Record<string, unknown>;
  loopJson: Record<string, unknown>;
  carriesPrompt: boolean;
  author: string;
  sourceStation?: string;
  sourceAgent?: string;
  reason?: string;
  rolledBackFrom?: number;
}

/** One entry of the tenant-wide bundle index that `loops bundle sync` reads. */
export interface LoopBundleSummary {
  bundleName: string;
  loopId: string;
  loopName: string;
  latestVersion: number;
  pinnedVersion?: number;
  bundleDigest?: string;
  carriesPrompt: boolean;
  machineId?: string;
  updatedAt: string;
}
