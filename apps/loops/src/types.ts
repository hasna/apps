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

export interface AgentAllowlistSpec {
  tools?: string[];
  commands?: string[];
  enforcement?: "metadata_only";
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
  extraArgs?: string[];
  addDirs?: string[];
  timeoutMs?: TimeoutMs;
  idleTimeoutMs?: number;
  configIsolation?: AgentConfigIsolation;
  permissionMode?: AgentPermissionMode;
  sandbox?: AgentSandbox;
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

export interface WorkflowEvent {
  id: string;
  workflowRunId: string;
  sequence: number;
  eventType: string;
  stepId?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

export interface Loop {
  id: string;
  name: string;
  description?: string;
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
  created_at: string;
  updated_at: string;
}

export interface WriteRunReceiptInput {
  loop_id?: string;
  run_id: string;
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
}

export interface PersistGuardOptions {
  beforePersist?: () => void;
  daemonLeaseId?: string;
}
