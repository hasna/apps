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

export interface CommandTarget {
  type: "command";
  command: string;
  args?: string[];
  cwd?: string;
  shell?: boolean;
  env?: Record<string, string>;
  timeoutMs?: number;
  account?: AccountRef;
  preflight?: RuntimePreflightPolicy;
}

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
}

export interface AgentTarget {
  type: "agent";
  provider: AgentProvider;
  prompt: string;
  cwd?: string;
  model?: string;
  variant?: string;
  agent?: string;
  authProfile?: string;
  extraArgs?: string[];
  timeoutMs?: number;
  configIsolation?: AgentConfigIsolation;
  permissionMode?: AgentPermissionMode;
  sandbox?: AgentSandbox;
  allowlist?: AgentAllowlistSpec;
  worktree?: AgentWorktreeSpec;
  routing?: AgentRoutingSpec;
  account?: AccountRef;
  preflight?: RuntimePreflightPolicy;
}

export interface WorkflowTarget {
  type: "workflow";
  workflowId: string;
  input?: Record<string, string>;
  timeoutMs?: number;
  preflight?: RuntimePreflightPolicy;
}

export type ExecutableTarget = CommandTarget | AgentTarget;

export type LoopTarget = ExecutableTarget | WorkflowTarget;

export type WorkflowStatus = "active" | "archived";

export type WorkflowRunStatus = "running" | "succeeded" | "failed" | "timed_out" | "cancelled";

export type WorkflowStepRunStatus = "pending" | "running" | "succeeded" | "failed" | "timed_out" | "skipped" | "cancelled";

export interface WorkflowStep {
  id: string;
  name?: string;
  description?: string;
  target: ExecutableTarget;
  goal?: GoalSpec;
  dependsOn?: string[];
  continueOnFailure?: boolean;
  timeoutMs?: number;
  account?: AccountRef;
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
  steps: WorkflowStep[];
  version?: number;
}

export type LoopTemplateKind = "workflow" | "loop";

export interface LoopTemplateVariable {
  name: string;
  description?: string;
  required?: boolean;
  default?: string;
}

export interface LoopTemplateSummary {
  id: string;
  name: string;
  description: string;
  kind: LoopTemplateKind;
  variables: LoopTemplateVariable[];
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowName: string;
  loopId?: string;
  loopRunId?: string;
  scheduledFor?: string;
  idempotencyKey?: string;
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
  exitCode?: number;
  durationMs?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
  goalRunId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLoopInput {
  name: string;
  description?: string;
  schedule: ScheduleSpec;
  target: LoopTarget;
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
